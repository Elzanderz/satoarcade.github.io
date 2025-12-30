# Sato Arcade - Bingo Battle

This is a modern, real-time multiplayer Bingo game built with React, Tailwind CSS, and Firebase.

## Features

- **Multiplayer**: Real-time gameplay with friends.
- **Items**: Use power-ups like Search, Bomb, and Shield.
- **Modern UI**: Clean and responsive design using Tailwind CSS.
- **Host System**: Create rooms and host games.

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

1.  Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```
2.  Fill in your Firebase configuration in `.env`. You can get these details from your Firebase Console.

    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```

### Running Locally

To start the development server:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Building for Production

To build the app for deployment:

```bash
npm run build
```

The output will be in the `dist` directory.

## Deployment

You can deploy this to GitHub Pages, Vercel, Netlify, or any static hosting service.

For GitHub Pages, you may need to configure the base path in `vite.config.js` if you are not deploying to the root domain.

## License

[MIT](LICENSE)
