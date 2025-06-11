# 🎨 SkinTip - AI Tattoo Visualization Platform

Live Demo: https://itayash22.github.io/SkinTip/frontend/

## 🌟 Project Overview

SkinTip is an innovative, mobile-first web application that empowers users to visualize tattoo designs directly on their own skin. Leveraging advanced AI, SkinTip provides a unique and realistic preview experience, helping users make informed decisions before getting inked. The platform operates on a token-based payment model, ensuring controlled API costs and a clear value exchange for users.

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
* 🔄 Real user authentication with Supabase (backend ready).
* 🔄 Payment integration with Stripe for token purchases.
* 🔄 Artist portfolio management and real artist profiles.
* 🔄 Integration with other AI models for specialized features (e.g., text-to-idea generation if quality improves).
* 🔄 Social sharing enhancements (e.g., direct Instagram sharing after download).

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
