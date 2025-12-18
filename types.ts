export type ThePosterDbMediaType = "movie" | "show";

export interface ThePosterDbSearchOptions {
	/**
	 * Explicit search query. Overrides title/year if provided.
	 */
	query?: string;
	/**
	 * Media title to search for.
	 */
	title?: string;
	/**
	 * Optional TMDB-derived title, used if present.
	 */
	tmdbTitle?: string;
	/**
	 * Release year to include in the search query.
	 */
	year?: number | string;
	/**
	 * Limit posters returned. Defaults to 18.
	 */
	limit?: number;
	/**
	 * Limit search scope to a specific media type.
	 */
	itemType?: ThePosterDbMediaType;
	/**
	 * Include base64-encoded poster previews.
	 */
	includeBase64?: boolean;
}

export interface ThePosterDbPoster {
	id: string;
	url: string;
	viewUrl: string;
	title: string;
	uploader?: string;
	likes?: number;
	base64?: string;
	contentType?: string;
}

