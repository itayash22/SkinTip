# 🚀 Render Deployment Guide for SkinTip

This guide will walk you through deploying your SkinTip backend to Render.

## Prerequisites

1. A [Render](https://render.com) account (free tier available)
2. A [Supabase](https://supabase.com) project
3. A [Flux API](https://flux.ai) key
4. Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)

## Step 1: Prepare Your Repository

Make sure your code is committed and pushed to your Git repository:

```bash
git add .
git commit -m "Add Render deployment configuration"
git push origin main
```

## Step 2: Create a New Web Service on Render

1. **Log in to Render Dashboard**: Go to [dashboard.render.com](https://dashboard.render.com)
2. **Click "New +"** → **"Web Service"**
3. **Connect your repository**: 
   - If this is your first time, connect your GitHub/GitLab/Bitbucket account
   - Select your repository
   - Click "Connect"

## Step 3: Configure the Service

### Basic Settings:
- **Name**: `skintip-backend` (or your preferred name)
- **Region**: Choose closest to your users
- **Branch**: `main` (or your deployment branch)
- **Root Directory**: Leave empty (root of repo)
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

### Environment Variables:

Click "Advanced" → "Add Environment Variable" and add the following:

#### Required Variables:
```
PORT=10000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-url.com
JWT_SECRET=<generate-a-strong-random-string>
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
SUPABASE_STORAGE_BUCKET=generated-tattoos
FLUX_API_KEY=your-flux-api-key
```

#### Optional Variables (if you have them):
```
REMOVE_BG_API_KEY=your-remove-bg-api-key
```

#### Optional Tuning Parameters (defaults are in code, only set if you want to override):
```
ADAPTIVE_SCALE_ENABLED=true
ADAPTIVE_ENGINE_ENABLED=true
MODEL_SCALE_UP=1.5
FLUX_ENGINE=kontext
ENGINE_KONTEXT_SIZE_BIAS=1.08
ENGINE_FILL_SIZE_BIAS=1.02
MODEL_MASK_GROW_PCT=0.06
MODEL_MASK_GROW_MIN=4
MODEL_MASK_GROW_MAX=28
BAKE_TATTOO_BRIGHTNESS=0.96
BAKE_TATTOO_GAMMA=1.00
BAKE_OVERLAY_OPACITY=0.28
BAKE_SOFTLIGHT_OPACITY=0.35
BAKE_MULTIPLY_OPACITY=0.12
ENGINE_KONTEXT_FIDELITY=0.65
ENGINE_KONTEXT_GUIDANCE=6.2
ENGINE_FILL_GUIDANCE=6.0
```

### Auto-Deploy:
- ✅ Enable "Auto-Deploy" if you want automatic deployments on git push

## Step 4: Deploy

1. Click **"Create Web Service"**
2. Render will start building your service
3. Watch the build logs - it should:
   - Install dependencies (`npm install`)
   - Start the server (`npm start`)
4. Once deployed, you'll get a URL like: `https://skintip-backend.onrender.com`

## Step 5: Update Frontend Configuration

Update your frontend `config.js` to point to your Render backend URL:

```javascript
const CONFIG = {
    API_BASE_URL: 'https://skintip-backend.onrender.com',
    // ... rest of config
};
```

## Step 6: Verify Deployment

1. Check the Render logs to ensure the server started successfully
2. Test the health endpoint: `https://your-backend-url.onrender.com/api/health` (if you have one)
3. Test authentication: Try logging in from your frontend

## Troubleshooting

### Build Fails:
- Check that all dependencies are in `package.json`
- Verify Node.js version compatibility (Render uses Node 18+ by default)
- Check build logs for specific errors

### Server Crashes:
- Check environment variables are all set correctly
- Verify API keys are valid
- Check server logs in Render dashboard

### CORS Issues:
- Ensure `FRONTEND_URL` is set correctly in environment variables
- Check that your frontend URL matches exactly (including https/http)

### API Errors:
- Verify `FLUX_API_KEY` is valid and has credits
- Check `SUPABASE_*` keys are correct
- Ensure Supabase storage bucket exists and is public

## Using render.yaml (Alternative Method)

If you prefer, you can use the `render.yaml` file included in this repo:

1. In Render dashboard, go to "New +" → "Blueprint"
2. Connect your repository
3. Render will automatically detect `render.yaml` and use it
4. You'll still need to set the `sync: false` environment variables manually in the dashboard

## Monitoring

- **Logs**: View real-time logs in Render dashboard
- **Metrics**: Monitor CPU, memory, and request metrics
- **Alerts**: Set up email alerts for service failures

## Updating Your Deployment

After making code changes:

1. Commit and push to your repository
2. If auto-deploy is enabled, Render will automatically redeploy
3. If not, manually trigger a deploy from the Render dashboard

## Cost Considerations

- **Free Tier**: 750 hours/month, services spin down after 15 min inactivity
- **Starter Plan**: $7/month - always-on service
- **Professional Plan**: $25/month - better performance, more resources

For production, consider the Starter plan to avoid cold starts.

---

**Need Help?** Check Render's [documentation](https://render.com/docs) or their [community forum](https://community.render.com).

