# theposterdb-ts

A TypeScript client for ThePosterDB.

## Scraping

This project scrapes theposterdb.com. This is against the terms of service of theposterdb.com so I encourage you to login and download the files you want, rather than scraping. Once an API is available this package should no longer be needed, but I built it for use in a personal project (https://github.com/joemaddalone/vogon).

## Installation

```bash
npm install theposterdb-ts
```

## Usage

### Initialization

Import the client and initialize it with your ThePosterDB credentials:

```typescript
import { ThePosterDbClient } from "theposterdb-ts";

const client = new ThePosterDbClient("your-email@example.com", "your-password");
```

### Search

Search for posters by title, year, or type.

```typescript
const posters = await client.search({
  title: "The Matrix",
  year: 1999, // Optional: Filter by year
  itemType: "movie", // Optional: 'movie' or 'show'
  limit: 10, // Optional: Limit number of results (default: 18)
  includeBase64: true, // Optional: Include base64 encoded image data (slower)
});

console.log(posters);
/*
[
  {
    id: "12345",
    title: "The Matrix (1999)",
    url: "https://theposterdb.com/api/assets/...",
    viewUrl: "https://theposterdb.com/poster/...",
    uploader: "User123",
    likes: 42
  },
  ...
]
*/
```

### Download Poster

Download a specific poster image as a Buffer.

```typescript
const { data, contentType } = await client.downloadPoster(posterUrl);
// data is a Buffer
// contentType is e.g. 'image/jpeg'

// Example: Save to file
import fs from "fs";
fs.writeFileSync("poster.jpg", data);
```

### Reset Session

If you need to clear the current session (cookies and tokens):

```typescript
await client.resetSession();
```
