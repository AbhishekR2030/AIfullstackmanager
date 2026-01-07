
# AlphaSeeker India - Deployment Guide

This guide will walk you through deploying your application for free using **Render (Backend)** and **Vercel (Frontend)**. Since this is your first time, follow these steps exactly.

---

## 🚀 Phase 1: Deploy the Backend (Render)

We will host the Python API on Render.

1.  **Sign Up**: Go to [render.com](https://render.com) and sign up (login with GitHub recommended).
2.  **Create Service**:
    *   Click the **"New +"** button -> Select **"Web Service"**.
    *   Connect your GitHub repository: `AlphaSeeker`.
3.  **Configure Settings**:
    *   **Name**: `alphaseeker-backend` (or similar)
    *   **Region**: `Singapore` works best for India (or default).
    *   **Runtime**: **Python 3**
    *   **Build Command**: `pip install -r backend/requirements.txt`
    *   **Start Command**: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
    *   **Plan Type**: Select **Free**.
4.  **Environment Variables**:
    *   Scroll down to "Environment Variables" and click "Add Environment Variable".
    *   Add your keys exactly as they are in your `.env` file:
        *   `GOOGLE_API_KEY`: `(Your value)`
        *   `OPENAI_API_KEY`: `(Your value)`
        *   `SECRET_KEY`: `(generate a random string)`
5.  **Deploy**:
    *   Click **"Create Web Service"**.
    *   Wait for 2-5 minutes. Look for "Your service is live" in the logs.
    *   **Copy URL**: At the top left, copy your backend URL. It will look like: `https://alphaseeker-backend.onrender.com`.

> **⚠️ Important Note**: On the free tier, your `portfolio_db.json` will reset if the server restarts (spins down after inactivity). For a real product, we would upgrade to a database later.

---

## 🚀 Phase 2: Deploy the Frontend (Vercel)

We will host the React Frontend on Vercel.

1.  **Sign Up**: Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2.  **Import Project**:
    *   Click **"Add New..."** -> **"Project"**.
    *   Find your `AlphaSeeker` repo and click **Import**.
3.  **Configure Project**:
    *   **Framework Preset**: It should auto-detect **Vite**.
    *   **Root Directory**: Click "Edit" and select `frontend`. (Important!)
4.  **Environment Variables**:
    *   Click "Environment Variables".
    *   Add the following:
        *   **Key**: `VITE_API_URL`
        *   **Value**: `(Paste your Render Backend URL here)`  
            *Example*: `https://alphaseeker-backend.onrender.com/api/v1`
            *(Make sure to add `/api/v1` at the end!)*
5.  **Deploy**:
    *   Click **"Deploy"**.
    *   Wait ~1 minute. You will see fireworks/confetti! 
    *   Click **"Continue to Dashboard"** -> **"Visit"**.

---

## 🎉 Done!
Your app is now live on the internet! You can share the Vercel link with anyone.

### Troubleshooting
*   **"Network Error" / "Failed to fetch"**: 
    1.  Check if your Backend (Render) is awake. Free tier sleeps after 15 mins. Loading the site might take 30s to wake it up.
    2.  Check if you added `/api/v1` to the `VITE_API_URL` variable in Vercel.
*   **"Authentication Failed"**: Ensure `SECRET_KEY` is set in Render env vars.

