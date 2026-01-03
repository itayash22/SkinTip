// backend/modules/geoService.js
// IP Geolocation service using ip-api.com (free tier: 45 requests/minute)

import axios from 'axios';

// Cache to avoid hitting rate limits
const geoCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const geoService = {
    /**
     * Get geolocation data from IP address
     * @param {string} ip - IP address to lookup
     * @returns {Object} - { country, city, countryCode, timezone }
     */
    getGeoFromIP: async (ip) => {
        // Skip for localhost/private IPs
        if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
            return { country: 'Local', city: 'Local', countryCode: 'XX', timezone: 'UTC' };
        }

        // Check cache first
        const cached = geoCache.get(ip);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.data;
        }

        try {
            // Using ip-api.com free tier (no API key required)
            const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,timezone`, {
                timeout: 3000 // 3 second timeout
            });

            if (response.data.status === 'success') {
                const geoData = {
                    country: response.data.country || 'Unknown',
                    city: response.data.city || 'Unknown',
                    countryCode: response.data.countryCode || 'XX',
                    timezone: response.data.timezone || 'UTC'
                };

                // Cache the result
                geoCache.set(ip, { data: geoData, timestamp: Date.now() });

                return geoData;
            } else {
                console.warn(`[GeoService] Failed to get geo for IP ${ip}:`, response.data);
                return { country: 'Unknown', city: 'Unknown', countryCode: 'XX', timezone: 'UTC' };
            }
        } catch (error) {
            console.warn(`[GeoService] Error fetching geo for IP ${ip}:`, error.message);
            return { country: 'Unknown', city: 'Unknown', countryCode: 'XX', timezone: 'UTC' };
        }
    },

    /**
     * Extract real IP from request (handles proxies/load balancers)
     * @param {Object} req - Express request object
     * @returns {string} - Client IP address
     */
    getClientIP: (req) => {
        // Check various headers set by proxies
        const forwardedFor = req.headers['x-forwarded-for'];
        if (forwardedFor) {
            // x-forwarded-for can be a comma-separated list
            return forwardedFor.split(',')[0].trim();
        }

        const realIP = req.headers['x-real-ip'];
        if (realIP) {
            return realIP;
        }

        // Fallback to connection remote address
        return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    },

    /**
     * Detect device type from User-Agent
     * @param {string} userAgent - User-Agent header
     * @returns {string} - 'mobile', 'tablet', or 'desktop'
     */
    getDeviceType: (userAgent) => {
        if (!userAgent) return 'unknown';

        const ua = userAgent.toLowerCase();

        // Check for mobile devices
        if (/android.*mobile|iphone|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua)) {
            return 'mobile';
        }

        // Check for tablets
        if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) {
            return 'tablet';
        }

        return 'desktop';
    },

    /**
     * Get full client info from request
     * @param {Object} req - Express request object
     * @returns {Object} - { ip, country, city, deviceType, userAgent }
     */
    getClientInfo: async (req) => {
        const ip = geoService.getClientIP(req);
        const userAgent = req.headers['user-agent'] || '';
        const deviceType = geoService.getDeviceType(userAgent);
        const geo = await geoService.getGeoFromIP(ip);

        return {
            ip,
            country: geo.country,
            city: geo.city,
            countryCode: geo.countryCode,
            timezone: geo.timezone,
            deviceType,
            userAgent
        };
    },

    /**
     * Clear the geo cache (for testing/memory management)
     */
    clearCache: () => {
        geoCache.clear();
    }
};

export default geoService;

