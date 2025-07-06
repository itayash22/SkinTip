# 🎨 SkinTip - AI Tattoo Visualization Platform

Live Demo: https://itayash22.github.io/SkinTip/frontend/

## 🌟 Project Overview

SkinTip is an innovative, mobile-first web application that empowers users to visualize tattoo designs directly on their own skin. Leveraging advanced AI, SkinTip provides a unique and realistic preview experience, helping users make informed decisions before getting inked. The platform operates on a token-based payment model, ensuring controlled API costs and a clear value exchange for users.

Code tree:
SkinTip/
├── frontend/                 # Live on GitHub Pages (https://itayash22.github.io/SkinTip/frontend/)
│   ├── index.html            # Main application UI
│   ├── css/                  # Stylesheets
│   │   └── styles.css
│   └── js/                   # JavaScript modules and scripts
│       ├── auth.js           # Handles user authentication flow
│       ├── config.js         # Global config and state (tokens, API URLs)
│       └── drawing.js        # Canvas drawing for tattoo area selection
├── backend/                  # Node.js API server (deployed on Render)
│   ├── server.js             # Main Express.js server, defines routes
│   ├── package.json          # Node.js dependencies (includes sharp, image-size, uuid)
│   ├── .env.example          # Example environment variables
│   └── modules/              # Modularized backend logic
│       ├── tokenService.js   # Manages user tokens via Supabase
│       └── fluxPlacementHandler.js. # Handles Flux API calls, image processing, watermarking, Supabase Storage upload
├── scripts/                  # Database setup scripts (e.g., SQL for Supabase)
└── docs/                     # Project documentation


## 🌳 **Development Branches & Tags**

* **`stable-v1.1-w` (Tagged Release)**: This tag points to the initial stable and fully functional version of the SkinTip platform. It includes user authentication, image upload, tattoo area selection, **text-based AI tattoo generation (using old Flux API)**, and artist Browse/contact. This served as a production-ready baseline.
* **`main` Branch**: This is the primary development branch. It contains the **latest code with the updated workflow**, focusing on user-uploaded tattoo designs for placement with Flux Kontext. Active feature development and bug fixes are performed here. This branch is directly deployed to Render.
* **`feature/your-new-feature-name` (Example)**: Future feature development will happen on dedicated branches branched off `main`.

## ⚙️ Backend Environment Variables (Render Configuration)

The `backend/server.js` and its modules rely on these environment variables, which **must be set on your Render backend service dashboard**:

* `PORT`: (e.g., `10000` - Render's default).
* `FRONTEND_URL`: (e.g., `https://itayash22.github.io/SkinTip/frontend/` or `*` for testing).
* `JWT_SECRET`: A strong, random string for JWT signing.
* `SUPABASE_URL`: Your Supabase Project URL (from Supabase Project Settings > API).
* `SUPABASE_ANON_KEY`: Your Supabase `anon` (public) API key (from Supabase Project Settings > API).
* `SUPABASE_SERVICE_KEY`: Your **Supabase `service_role` (secret) API key**. **Extremely sensitive - NEVER expose.** (from Supabase Project Settings > API). Used by `tokenService` and `fluxKontextHandler`.
* `SUPABASE_STORAGE_BUCKET`: The name of your Supabase Storage bucket for generated images (e.g., `generated-tattoos`).
* `FLUX_API_KEY`: Your API key for Flux.ai (Black Forest Labs).

## 💰 Token-Based Business Model & Pricing

SkinTip operates on a token system to manage AI generation costs.

* **Token Value:** 1 Token = $0.01
* **Action Cost:**
    * **Flux Tattoo Placement (3 images, watermarked):** **15 Tokens ($0.15)**
* **Token Packages (Examples for Sale):**
    * **Free Trial:** 20 Tokens (given upon new user registration). Allows 1 Flux Placement, leaving 5 tokens change.
    * **Small Pack:** 20 Tokens for $0.20 (Ensures change, e.g., buy this, make 1 placement, left with 5 tokens).
    * **Medium Pack:** 50 Tokens for $0.45 (10% discount).
    * **Large Pack:** 100 Tokens for $0.80 (20% discount).
* **Cost Control:** Token deductions are handled server-side (`tokenService.js`). Users can only spend tokens they possess, providing a hard ceiling on API usage and preventing abuse.

## 🎯 Current Development Status & Next Steps for Developer

* **Frontend (`index.html`, `config.js`, `drawing.js`):** Updated with new UX flow for tattoo design upload, skin photo upload, drawing, and streamlined generation. Token display implemented.
* **Backend (`tokenService.js`, `fluxKontextHandler.js`):** New modules created and integrated with Supabase for token management, Flux Kontext API calls, image watermarking, and Supabase Storage uploads.
* **Backend (`server.js`):** Needs to be updated to integrate these new modules and set up the new dedicated `/api/generate-final-tattoo` endpoint, completely replacing the old Flux API call logic and removing the old `generateMultipleVariations` function.

## ✨ Key Features & Functionality

### Current State (`main` branch)
* ✅ **User Authentication:** Secure user registration and login (managed via Supabase backend).
* ✅ **Tattoo Design Upload:** Users upload their own tattoo design image (PNG/JPG, transparent background preferred).
* ✅ **Skin Photo Upload:** Users upload a photo of their skin where they want to place the tattoo.
* ✅ **Tattoo Area Selection:** Intuitive drawing tool to mark the precise area on the skin photo for tattoo placement.
* ✅ **AI-Powered Tattoo Placement:** Integrates the uploaded tattoo design onto the skin photo using advanced AI (Flux Kontext model).
* ✅ **Multiple Variations:** Generates 3 different realistic visualization previews per request.
* ✅ **Watermarking:** All AI-generated images are watermarked with "SkinTip.AI".
* ✅ **Token-Based Payments:** Users purchase tokens to perform AI generation actions. Costs are clearly displayed.
* ✅ **Browse Tattoo Artists:** Demo feature to explore artists (can be filtered by location/style).
* ✅ **WhatsApp Integration:** Direct contact with demo artists via WhatsApp.
* ✅ **Mobile Friendly:** Designed for a seamless experience on all mobile devices.

### Coming Soon / Next Steps
* 🔄 Payment integration with Stripe for token purchases.
* 🔄 Artist portfolio management and real artist profiles.
* 🔄 Social sharing enhancements (e.g., direct Instagram sharing after download).
* 🔄 Go over entire UX and text and polish
* 🔄 Obfuscate the "secret sauce" to create the pics

## 🚀 How to Use (Current Workflow)

1.  **Register/Login:** Create an account or login.
2.  **Upload Tattoo Design:** Choose or create a tattoo design image (PNG with transparent background is ideal).
    * *Need an idea?* Use the provided link to external AI image generators like Bing Copilot / Midjourney, asking for "sketches on a transparent background, NOT a tattoo."
3.  **Upload Skin Photo:** Upload a photo of yourself where you want the tattoo.
4.  **Mark Area:** Use the drawing tool to outline the exact area for your tattoo.
5.  **Generate:** Click "Generate Tattoo on Skin" to see AI-generated previews (costs tokens).
6.  **Review & Share:** View variations, download them, and share your favorites.
7.  **Find Artist:** Browse and contact artists via WhatsApp.

## 🛠️ Tech Stack

* **Frontend**: HTML5, CSS3, Vanilla JavaScript
* **Backend**: Node.js, Express.js
* **Database**: Supabase (PostgreSQL for user/token/transactions, Storage for generated images)
* **AI Integration**:
    * **Flux API (`flux-kontext-pro`)**: For realistic tattoo placement onto skin (image-to-image inpainting with reference).
* **Image Processing (Backend)**: `sharp` (for resizing, mask inversion, watermarking)
* **Other Backend Utilities**: `image-size` (for dimension validation), `uuid` (for unique filenames), `bcryptjs`, `jsonwebtoken` (for auth).
* **Hosting**: GitHub Pages (frontend), Render (backend)

## 🔗 Project Structure
## 🌳 **Version History & Development Branches**

* **`release-v1.0.0-stable` Branch**: This branch serves as a static snapshot of the first stable and fully functional version of the SkinTip platform. It was created from `main` on [Date of creation, e.g., June 10, 2025] and includes core features like user authentication, image upload, tattoo area selection, text-based AI tattoo generation, and artist Browse/contact. It should be treated as a read-only historical marker.

* **`main` Branch**: This is the primary development branch. All active feature development and bug fixes for SkinTip are performed here. This branch may contain incomplete or experimental code during its development phase. The current work for the "two-image tattoo generation" feature is being developed here.

---

Made with ❤️ by @itayash22
