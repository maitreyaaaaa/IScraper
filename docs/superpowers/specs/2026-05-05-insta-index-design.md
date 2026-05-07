# Design Spec: Insta Index Harness
**Date:** 2026-05-05
**Status:** Draft

## 1. Overview
The **Insta Index Harness** is a personal indexing agent that transforms a user's Instagram "Saved Posts" export into a searchable, AI-enriched knowledge base. It extracts captions, downloads videos, and uses Gemini 2.0 Flash to generate transcripts and visual descriptions, providing a high-quality search experience for bookmarked content.

## 2. Architecture
The project follows a modular service-oriented architecture with a clear separation between the processing pipeline (Orchestration) and the presentation layer (UI).

### 2.1 Backend (Orchestration) - Node.js
- **Parser Service:** Parses `saved_posts.html` from the Instagram data export. Uses `cheerio` to extract post URLs, original captions, and timestamps.
- **Downloader Service:** Uses `yt-dlp-exec` to download video files from the extracted Instagram URLs.
- **Analysis Service (Gemini API):** 
    - Uploads video files to the Gemini File API.
    - Prompts Gemini 2.0 Flash to generate:
        - A full transcript of the audio.
        - A detailed visual description of the video content.
        - Relevant tags and a summary title.
- **Index Store:** Maintains a local `index.json` containing the merged metadata (Original Caption + AI Transcript + AI Visual Description).

### 2.2 Frontend (UI) - React + Vanilla CSS
- **Search Engine:** A robust client-side search (e.g., `fuse.js`) over the `index.json`.
- **Bento Grid Gallery:** A modern, responsive grid that displays video cards with varying sizes based on content relevance or date.
- **Detail View:** A modal or expanded card view showing the full AI transcript and visual summary alongside the original post link.
- **Theme:** Dark mode by default, high-contrast, content-focused.

## 3. Data Flow
1. **Input:** User places Instagram export folder in `/data`.
2. **Parsing:** Parser extracts ~X number of video URLs and metadata.
3. **Queueing:** Each URL is added to a processing queue.
4. **Processing:**
    - Download video -> `data/videos/`.
    - Analyze with Gemini -> metadata objects.
5. **Persistence:** Results are appended to `data/index.json`.
6. **Delivery:** React UI reads `data/index.json` and serves the searchable interface.

## 4. Tech Stack
- **Runtime:** Node.js (v24+)
- **Backend:** Express, Cheerio (parsing), yt-dlp-exec (downloading), @google/generative-ai (Gemini).
- **Frontend:** React (Vite), Vanilla CSS, Lucide-React (icons).
- **Storage:** Local filesystem (`/data` folder).

## 5. Security & Privacy
- All video processing happens locally (download) and via the user's Gemini API key.
- No data is uploaded to external databases; the index lives entirely on the user's machine.

## 6. Future Scope
- Support for saved collections.
- Automatic categorization using LLM embeddings.
- Native mobile wrapper (Capacitor/React Native).
