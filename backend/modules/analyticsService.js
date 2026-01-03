// backend/modules/analyticsService.js
// Analytics data queries and aggregation

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const analyticsService = {
    /**
     * Get overview KPIs
     */
    getOverview: async () => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Total users
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        // New users today
        const { count: newUsersToday } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today);

        // New users this week
        const { count: newUsersWeek } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', weekAgo);

        // Active users today
        const { data: activeToday } = await supabase
            .from('user_events')
            .select('user_id')
            .gte('created_at', today);
        const activeUsersToday = new Set(activeToday?.map(e => e.user_id) || []).size;

        // Active users this week
        const { data: activeWeek } = await supabase
            .from('user_events')
            .select('user_id')
            .gte('created_at', weekAgo);
        const activeUsersWeek = new Set(activeWeek?.map(e => e.user_id) || []).size;

        // Total generations (WhatsApp contacts)
        const { count: totalContacts } = await supabase
            .from('user_events')
            .select('*', { count: 'exact', head: true })
            .eq('event_type', 'WHATSAPP_CONTACT');

        // API cost this month
        const { data: usageData } = await supabase
            .from('daily_usage')
            .select('total_cost')
            .gte('date', monthAgo.split('T')[0]);
        const totalApiCost = usageData?.reduce((sum, d) => sum + (parseFloat(d.total_cost) || 0), 0) || 0;

        return {
            totalUsers: totalUsers || 0,
            newUsersToday: newUsersToday || 0,
            newUsersWeek: newUsersWeek || 0,
            activeUsersToday,
            activeUsersWeek,
            totalContacts: totalContacts || 0,
            totalApiCost: totalApiCost.toFixed(2),
            dauMauRatio: totalUsers > 0 ? ((activeUsersToday / totalUsers) * 100).toFixed(1) : 0
        };
    },

    /**
     * Get user growth data
     */
    getUserGrowth: async (days = 30) => {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const { data: users } = await supabase
            .from('users')
            .select('created_at')
            .gte('created_at', startDate)
            .order('created_at', { ascending: true });

        // Group by date
        const dailyCounts = {};
        users?.forEach(user => {
            const date = user.created_at.split('T')[0];
            dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        });

        // Fill in missing dates
        const result = [];
        let cumulative = 0;
        for (let i = days; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const count = dailyCounts[date] || 0;
            cumulative += count;
            result.push({ date, newUsers: count, cumulative });
        }

        return result;
    },

    /**
     * Get retention cohort data
     */
    getRetention: async () => {
        const { data: users } = await supabase
            .from('users')
            .select('id, created_at')
            .gte('created_at', new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString());

        const { data: events } = await supabase
            .from('user_events')
            .select('user_id, created_at')
            .gte('created_at', new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString());

        // Group users by cohort week
        const cohorts = {};
        users?.forEach(user => {
            const cohortWeek = getWeekStart(new Date(user.created_at));
            if (!cohorts[cohortWeek]) {
                cohorts[cohortWeek] = { users: new Set(), size: 0 };
            }
            cohorts[cohortWeek].users.add(user.id);
            cohorts[cohortWeek].size++;
        });

        // Track activity by week
        const userActivity = {};
        events?.forEach(event => {
            const week = getWeekStart(new Date(event.created_at));
            if (!userActivity[event.user_id]) {
                userActivity[event.user_id] = new Set();
            }
            userActivity[event.user_id].add(week);
        });

        // Calculate retention for each cohort
        const result = [];
        Object.entries(cohorts).forEach(([cohortWeek, cohort]) => {
            const retention = { cohortWeek, cohortSize: cohort.size, weeks: [] };
            
            for (let w = 0; w <= 4; w++) {
                const targetWeek = addWeeks(new Date(cohortWeek), w).toISOString().split('T')[0];
                let retained = 0;
                cohort.users.forEach(userId => {
                    if (userActivity[userId]?.has(targetWeek)) {
                        retained++;
                    }
                });
                retention.weeks.push({
                    week: w,
                    retained,
                    rate: cohort.size > 0 ? ((retained / cohort.size) * 100).toFixed(1) : 0
                });
            }
            result.push(retention);
        });

        return result.sort((a, b) => b.cohortWeek.localeCompare(a.cohortWeek)).slice(0, 8);
    },

    /**
     * Get geographic distribution
     */
    getGeoDistribution: async () => {
        const { data } = await supabase
            .from('user_events')
            .select('geo_country, user_id')
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .not('geo_country', 'is', null);

        // Group by country
        const countryStats = {};
        data?.forEach(event => {
            const country = event.geo_country || 'Unknown';
            if (!countryStats[country]) {
                countryStats[country] = { users: new Set(), events: 0 };
            }
            countryStats[country].users.add(event.user_id);
            countryStats[country].events++;
        });

        return Object.entries(countryStats)
            .map(([country, stats]) => ({
                country,
                uniqueUsers: stats.users.size,
                totalEvents: stats.events
            }))
            .sort((a, b) => b.uniqueUsers - a.uniqueUsers)
            .slice(0, 15);
    },

    /**
     * Get event funnel data
     */
    getEventFunnel: async () => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const { data } = await supabase
            .from('user_events')
            .select('event_type, user_id')
            .gte('created_at', thirtyDaysAgo);

        const eventsByType = {};
        data?.forEach(event => {
            if (!eventsByType[event.event_type]) {
                eventsByType[event.event_type] = new Set();
            }
            eventsByType[event.event_type].add(event.user_id);
        });

        const sketchClicks = eventsByType['SKETCH_CLICK']?.size || 0;
        const uploads = eventsByType['SKIN_UPLOAD_APPROVED']?.size || 0;
        const generations = eventsByType['GENERATE_TATTOO']?.size || 0;
        const contacts = eventsByType['WHATSAPP_CONTACT']?.size || 0;

        return {
            steps: [
                { name: 'Sketch Click', users: sketchClicks, rate: 100 },
                { name: 'Skin Upload', users: uploads, rate: sketchClicks > 0 ? ((uploads / sketchClicks) * 100).toFixed(1) : 0 },
                { name: 'Generate', users: generations, rate: sketchClicks > 0 ? ((generations / sketchClicks) * 100).toFixed(1) : 0 },
                { name: 'WhatsApp Contact', users: contacts, rate: sketchClicks > 0 ? ((contacts / sketchClicks) * 100).toFixed(1) : 0 }
            ],
            conversionRate: sketchClicks > 0 ? ((contacts / sketchClicks) * 100).toFixed(1) : 0
        };
    },

    /**
     * Get revenue/cost data
     */
    getRevenue: async (days = 30) => {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const { data } = await supabase
            .from('daily_usage')
            .select('*')
            .gte('date', startDate)
            .order('date', { ascending: true });

        const totalCost = data?.reduce((sum, d) => sum + (parseFloat(d.total_cost) || 0), 0) || 0;
        const totalRequests = data?.reduce((sum, d) => sum + (d.request_count || 0), 0) || 0;

        return {
            dailyData: data || [],
            totalCost: totalCost.toFixed(2),
            totalRequests,
            avgCostPerRequest: totalRequests > 0 ? (totalCost / totalRequests).toFixed(4) : 0
        };
    },

    /**
     * Get device distribution
     */
    getDeviceDistribution: async () => {
        const { data } = await supabase
            .from('user_events')
            .select('device_type, user_id')
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .not('device_type', 'is', null);

        const deviceStats = {};
        data?.forEach(event => {
            const device = event.device_type || 'unknown';
            if (!deviceStats[device]) {
                deviceStats[device] = new Set();
            }
            deviceStats[device].add(event.user_id);
        });

        return Object.entries(deviceStats)
            .map(([device, users]) => ({
                device,
                users: users.size
            }))
            .sort((a, b) => b.users - a.users);
    },

    /**
     * Get top artists by engagement
     */
    getTopArtists: async () => {
        const { data: events } = await supabase
            .from('user_events')
            .select('artist_id, event_type, user_id')
            .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
            .not('artist_id', 'is', null);

        const { data: artists } = await supabase
            .from('artists')
            .select('id, name, location');

        const artistMap = {};
        artists?.forEach(a => { artistMap[a.id] = a; });

        const artistStats = {};
        events?.forEach(event => {
            if (!artistStats[event.artist_id]) {
                artistStats[event.artist_id] = { clicks: 0, contacts: 0, users: new Set() };
            }
            artistStats[event.artist_id].users.add(event.user_id);
            if (event.event_type === 'SKETCH_CLICK') artistStats[event.artist_id].clicks++;
            if (event.event_type === 'WHATSAPP_CONTACT') artistStats[event.artist_id].contacts++;
        });

        return Object.entries(artistStats)
            .map(([artistId, stats]) => ({
                artistId,
                name: artistMap[artistId]?.name || 'Unknown',
                location: artistMap[artistId]?.location || '',
                clicks: stats.clicks,
                contacts: stats.contacts,
                uniqueUsers: stats.users.size
            }))
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 10);
    },

    /**
     * Get active alerts
     */
    getAlerts: async () => {
        const { data } = await supabase
            .from('analytics_alerts')
            .select('*')
            .eq('is_resolved', false)
            .order('created_at', { ascending: false })
            .limit(20);

        return data || [];
    },

    /**
     * Check and generate alerts
     */
    checkAlerts: async () => {
        const alerts = [];
        const now = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];

        // Check for usage spike
        const { data: recentUsage } = await supabase
            .from('daily_usage')
            .select('total_cost, date')
            .order('date', { ascending: false })
            .limit(7);

        if (recentUsage && recentUsage.length >= 2) {
            const todayCost = parseFloat(recentUsage[0]?.total_cost) || 0;
            const avgCost = recentUsage.slice(1).reduce((sum, d) => sum + (parseFloat(d.total_cost) || 0), 0) / (recentUsage.length - 1);
            
            if (todayCost > avgCost * 2 && todayCost > 1) {
                alerts.push({
                    alert_type: 'USAGE_SPIKE',
                    severity: 'warning',
                    message: `API cost today ($${todayCost.toFixed(2)}) is more than 2x the average ($${avgCost.toFixed(2)})`,
                    data: { todayCost, avgCost }
                });
            }
        }

        // Check for low retention (D7 < 10%)
        const retention = await analyticsService.getRetention();
        if (retention.length > 0) {
            const latestCohort = retention[0];
            if (latestCohort.weeks[1] && parseFloat(latestCohort.weeks[1].rate) < 10 && latestCohort.cohortSize >= 5) {
                alerts.push({
                    alert_type: 'LOW_RETENTION',
                    severity: 'warning',
                    message: `Week 1 retention is only ${latestCohort.weeks[1].rate}% for cohort ${latestCohort.cohortWeek}. Consider improving onboarding.`,
                    data: { cohort: latestCohort.cohortWeek, rate: latestCohort.weeks[1].rate }
                });
            }
        }

        // Check for users with low tokens
        const { count: lowTokenUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .lt('tokens_remaining', 5)
            .gt('tokens_remaining', 0);

        if (lowTokenUsers && lowTokenUsers > 10) {
            alerts.push({
                alert_type: 'LOW_TOKENS',
                severity: 'info',
                message: `${lowTokenUsers} users have fewer than 5 tokens remaining. Consider sending a token purchase reminder.`,
                data: { count: lowTokenUsers }
            });
        }

        // Check for inactive users (30 days)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: activeUserIds } = await supabase
            .from('user_events')
            .select('user_id')
            .gte('created_at', thirtyDaysAgo);
        const activeSet = new Set(activeUserIds?.map(e => e.user_id) || []);
        
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        const inactiveCount = (totalUsers || 0) - activeSet.size;
        const inactivePercent = totalUsers > 0 ? (inactiveCount / totalUsers * 100).toFixed(1) : 0;

        if (inactivePercent > 50 && inactiveCount > 10) {
            alerts.push({
                alert_type: 'HIGH_CHURN',
                severity: 'warning',
                message: `${inactivePercent}% of users (${inactiveCount}) have been inactive for 30+ days. Consider a re-engagement campaign.`,
                data: { inactiveCount, inactivePercent }
            });
        }

        // Insert new alerts (avoid duplicates for today)
        for (const alert of alerts) {
            // Check if similar alert exists today
            const { data: existing } = await supabase
                .from('analytics_alerts')
                .select('id')
                .eq('alert_type', alert.alert_type)
                .gte('created_at', today)
                .limit(1);

            if (!existing || existing.length === 0) {
                await supabase.from('analytics_alerts').insert({
                    ...alert,
                    created_at: now
                });
            }
        }

        return alerts;
    },

    /**
     * Get recommendations based on analytics
     */
    getRecommendations: async () => {
        const recommendations = [];
        
        // Analyze top performing sketches/styles
        const { data: events } = await supabase
            .from('user_events')
            .select('stencil_id, event_type')
            .eq('event_type', 'SKETCH_CLICK')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

        const stencilCounts = {};
        events?.forEach(e => {
            if (e.stencil_id) {
                stencilCounts[e.stencil_id] = (stencilCounts[e.stencil_id] || 0) + 1;
            }
        });

        const topStencils = Object.entries(stencilCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        if (topStencils.length > 0) {
            recommendations.push({
                type: 'TOP_CONTENT',
                message: `Top performing sketches this week: ${topStencils.length} sketches getting most clicks`,
                action: 'Consider featuring these in promotions'
            });
        }

        // Check geo concentration
        const geo = await analyticsService.getGeoDistribution();
        if (geo.length > 0 && geo[0].uniqueUsers > 10) {
            recommendations.push({
                type: 'GEO_OPPORTUNITY',
                message: `${geo[0].country} is your top market with ${geo[0].uniqueUsers} users`,
                action: 'Consider localized content or artist partnerships in this region'
            });
        }

        // Check device split
        const { data: deviceData } = await supabase
            .from('user_events')
            .select('device_type')
            .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
            .not('device_type', 'is', null);

        const deviceCounts = { mobile: 0, desktop: 0, tablet: 0 };
        deviceData?.forEach(e => {
            if (e.device_type) deviceCounts[e.device_type] = (deviceCounts[e.device_type] || 0) + 1;
        });

        const mobilePercent = deviceData?.length > 0 
            ? (deviceCounts.mobile / deviceData.length * 100).toFixed(0) 
            : 0;

        if (mobilePercent > 60) {
            recommendations.push({
                type: 'DEVICE_INSIGHT',
                message: `${mobilePercent}% of your users are on mobile`,
                action: 'Prioritize mobile UX improvements'
            });
        }

        return recommendations;
    }
};

// Helper functions
function getWeekStart(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().split('T')[0];
}

function addWeeks(date, weeks) {
    const d = new Date(date);
    d.setDate(d.getDate() + weeks * 7);
    return d;
}

export default analyticsService;

