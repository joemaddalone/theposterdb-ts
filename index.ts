import { load } from "cheerio";
import {
	parse as parseSetCookie,
	splitCookiesString,
	CookieMap,
} from "set-cookie-parser";


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


const BASE_URL = "https://theposterdb.com";
const SEARCH_PATH = "/search";
const DEFAULT_MAX_RESULTS = 18;

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MEDIA_SECTION_MAP: Record<ThePosterDbMediaType, string> = {
	movie: "movies",
	show: "shows",
};

type CookieJar = Record<string, string>;

interface PosterLink {
	title: string;
	href: string;
	elementText: string;
}

export class ThePosterDbClient {
	private email: string;
	private password: string;
	private cookies: CookieJar = {};
	private csrfToken: string | null = null;
	private loggedIn = false;
	private loggingIn = false;

	constructor(email?: string, password?: string) {
		if (!email || !password) {
			throw new Error(
				"ThePosterDB credentials are required. Set THEPOSTERDB_EMAIL and THEPOSTERDB_PASSWORD."
			);
		}

		this.email = email;
		this.password = password;
	}

	/**
	 * Perform poster search on ThePosterDB. Automatically logs in if needed.
	 */
	async search(
		options: ThePosterDbSearchOptions
	): Promise<ThePosterDbPoster[]> {
		await this.ensureLoggedIn();

		const query = this.buildQuery(options);
		const searchUrl = this.buildSearchUrl(query, options.itemType);
		const response = await this.fetchWithSession(searchUrl);

		if (!response.ok) {
			if (response.status === 401 || response.status === 403) {
				await this.resetSession();
				await this.ensureLoggedIn();
				return this.search(options);
			}

			throw new Error(
				`Failed to search ThePosterDB (${response.status} ${response.statusText})`
			);
		}

		const html = await response.text();
		const searchLinks = this.extractSearchLinks(html);

		if (searchLinks.length === 0) {
			return [];
		}

		const bestMatch = this.selectBestMatch(searchLinks, query);
		if (!bestMatch) {
			return [];
		}

		const posterPageUrl = this.resolveUrl(bestMatch.href);
		const posterResponse = await this.fetchWithSession(posterPageUrl);

		if (!posterResponse.ok) {
			throw new Error(
				`Failed to load ThePosterDB item page (${posterResponse.status} ${posterResponse.statusText})`
			);
		}

		const posterHtml = await posterResponse.text();
		const includeBase64 = options.includeBase64 ?? false;
		const limit = options.limit ?? DEFAULT_MAX_RESULTS;

		const posters = await this.extractPosterLinks(
			posterHtml,
			includeBase64,
			limit
		);

		return posters;
	}

	/**
	 * Download a poster image as Buffer.
	 */
	async downloadPoster(
		url: string
	): Promise<{ data: Buffer; contentType: string; }> {
		await this.ensureLoggedIn();

		const response = await this.fetchWithSession(url, {
			headers: {
				Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Failed to download poster from ThePosterDB (${response.status} ${response.statusText})`
			);
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const contentType =
			response.headers.get("content-type") || this.getContentTypeFromUrl(url);

		return { data: buffer, contentType };
	}

	/**
	 * Reset session and clear cookies.
	 */
	async resetSession() {
		this.cookies = {};
		this.csrfToken = null;
		this.loggedIn = false;
	}

	private async ensureLoggedIn(): Promise<void> {
		if (this.loggedIn && Object.keys(this.cookies).length > 0) {
			return;
		}

		if (this.loggingIn) {
			await this.waitForLogin();
			return;
		}

		this.loggingIn = true;
		try {
			await this.login();
			this.loggedIn = true;
		} finally {
			this.loggingIn = false;
		}
	}

	private async waitForLogin() {
		while (this.loggingIn) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	private async login() {
		this.cookies = {};
		this.csrfToken = null;
		this.loggedIn = false;

		const loginUrl = `${BASE_URL}/login`;

		const loginPage = await fetch(loginUrl, {
			headers: this.buildHeaders(),
		});

		this.captureCookies(loginPage.headers.getSetCookie?.());
		const loginHtml = await loginPage.text();
		this.csrfToken = this.extractCsrfToken(loginHtml);

		const payload = new URLSearchParams();
		if (this.csrfToken) {
			payload.set("_token", this.csrfToken);
			payload.set("authenticity_token", this.csrfToken);
		}
		payload.set("login", this.email);
		payload.set("password", this.password);
		payload.set("remember", "on");

		const response = await fetch(loginUrl, {
			method: "POST",
			headers: {
				...this.buildHeaders(),
				"Content-Type": "application/x-www-form-urlencoded",
				Origin: BASE_URL,
				Referer: loginUrl,
			},
			body: payload.toString(),
			redirect: "manual",
		});

		this.captureCookies(response.headers.getSetCookie?.());

		if (response.status >= 400) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`ThePosterDB login failed (${response.status}). ${/invalid|incorrect/i.test(text) ? "Check credentials." : ""
					}`.trim()
			);
		}

		// Successful login typically returns a redirect. If we land back on login, treat as failure.
		if (response.status === 302 || response.status === 303) {
			this.loggedIn = true;
			return;
		}

		const responseText = await response.text();
		if (/invalid|incorrect/i.test(responseText)) {
			throw new Error("ThePosterDB login failed: invalid credentials.");
		}

		this.loggedIn = true;
	}

	private buildQuery(options: ThePosterDbSearchOptions): string {
		if (options.query) {
			return options.query.trim();
		}

		const title =
			options.tmdbTitle?.trim() ??
			options.title?.trim() ??
			(() => {
				throw new Error("A title or query is required to search ThePosterDB.");
			})();

		if (options.year) {
			const year =
				typeof options.year === "number" ? options.year : options.year.trim();
			return `${title} (${year})`;
		}

		return title;
	}

	private buildSearchUrl(query: string, type?: ThePosterDbMediaType): string {
		const params = new URLSearchParams({
			term: query,
		});

		if (type) {
			const section = MEDIA_SECTION_MAP[type];
			if (section) {
				params.set("section", section);
			}
		}

		return `${BASE_URL}${SEARCH_PATH}?${params.toString()}`;
	}

	private async fetchWithSession(
		url: string,
		init?: RequestInit
	): Promise<Response> {
		const headers = this.buildHeaders(init?.headers);

		const response = await fetch(url, {
			...init,
			headers,
		});

		this.captureCookies(response.headers.getSetCookie?.());

		// If we were redirected to login, treat as unauthorized.
		if (response.url.endsWith("/login")) {
			await this.resetSession();
			return new Response(null, { status: 401 });
		}

		return response;
	}

	private buildHeaders(extraHeaders?: HeadersInit): Record<string, string> {
		const headers: Record<string, string> = {
			"User-Agent": USER_AGENT,
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		};

		if (Object.keys(this.cookies).length > 0) {
			headers.Cookie = this.serializeCookies();
		}

		if (this.csrfToken) {
			headers["X-CSRF-Token"] = this.csrfToken;
		}

		if (extraHeaders) {
			if (Array.isArray(extraHeaders)) {
				extraHeaders.forEach(([key, value]) => {
					headers[key] = value;
				});
			} else if (extraHeaders instanceof Headers) {
				extraHeaders.forEach((value, key) => {
					headers[key] = value;
				});
			} else {
				Object.assign(headers, extraHeaders);
			}
		}

		return headers;
	}

	private extractSearchLinks(html: string): PosterLink[] {
		const $ = load(html);
		const selector =
			"a.btn.btn-dark-lighter.flex-grow-1.text-truncate.py-2.text-left.position-relative";
		const links: PosterLink[] = [];

		$(selector).each((_, element) => {
			const link = $(element);
			const href = link.attr("href");
			if (!href) {
				return;
			}

			const text =
				link.find(".text-truncate").text().trim() || link.text().trim();

			links.push({
				href,
				title: link.attr("title") || text,
				elementText: text,
			});
		});

		return links;
	}

	private selectBestMatch(
		links: PosterLink[],
		query: string
	): PosterLink | null {
		if (links.length === 0) {
			return null;
		}

		const normalizedQuery = this.normalizeTitle(query);
		let bestScore = 0;
		let bestLink: PosterLink | null = null;

		for (const link of links) {
			const score = this.calculateTitleScore(
				normalizedQuery,
				this.normalizeTitle(link.elementText)
			);
			if (score > bestScore) {
				bestScore = score;
				bestLink = link;
			}
		}

		return bestLink ?? links[0];
	}

	private async extractPosterLinks(
		html: string,
		includeBase64: boolean,
		limit: number
	): Promise<ThePosterDbPoster[]> {
		const $ = load(html);
		const selector = "a.bg-transparent.border-0.text-white[href]";
		const posters: ThePosterDbPoster[] = [];

		$(selector)
			.slice(0, limit)
			.each((index, element) => {
				const link = $(element);
				const href = link.attr("href");
				if (!href) {
					return;
				}

				const absoluteUrl = this.resolveUrl(href);
				const image = link.find("img").first();
				const title =
					image.attr("alt") || link.attr("title") || `Poster ${index + 1}`;
				const likesRaw = link.attr("data-likes");
				const likes = likesRaw ? Number.parseInt(likesRaw, 10) : undefined;
				const uploader =
					link.find('[data-role="uploader"]').text().trim() || undefined;

				posters.push({
					id: (index + 1).toString(),
					url: absoluteUrl,
					viewUrl: absoluteUrl.replace("/download", "/view"),
					title,
					uploader,
					likes: Number.isNaN(likes) ? undefined : likes,
				});
			});

		if (includeBase64) {
			await Promise.all(
				posters.map(async (poster) => {
					try {
						const { base64, contentType } = await this.fetchPosterAsBase64(
							poster.url
						);
						poster.base64 = base64;
						poster.contentType = contentType;
					} catch (error) {
						console.error(
							`Failed to fetch ThePosterDB preview for ${poster.url}:`,
							error
						);
					}
				})
			);
		}

		return posters;
	}

	private async fetchPosterAsBase64(url: string): Promise<{
		base64: string;
		contentType: string;
	}> {
		const { data, contentType } = await this.downloadPoster(url);
		return {
			base64: `data:${contentType};base64,${data.toString("base64")}`,
			contentType,
		};
	}

	private getContentTypeFromUrl(url: string): string {
		const extension = url.split(".").pop()?.toLowerCase() || "";
		switch (extension) {
			case "png":
				return "image/png";
			case "jpg":
			case "jpeg":
				return "image/jpeg";
			case "webp":
				return "image/webp";
			default:
				return "application/octet-stream";
		}
	}

	private extractCsrfToken(html: string): string | null {
		const $ = load(html);
		const formToken = $('input[name="_token"]').attr("value");
		if (formToken) {
			return formToken;
		}

		const metaToken = $('meta[name="csrf-token"]').attr("content");
		if (metaToken) {
			return metaToken;
		}

		const authenticityToken = $('input[name="authenticity_token"]').attr(
			"value"
		);
		if (authenticityToken) {
			return authenticityToken;
		}

		return null;
	}

	private captureCookies(setCookieHeader?: string[] | string) {
		if (!setCookieHeader || setCookieHeader.length === 0) {
			return;
		}

		const cookieStrings = splitCookiesString(setCookieHeader);
		const parsed = parseSetCookie(cookieStrings, { map: true }) as CookieMap;

		Object.entries(parsed).forEach(([name, cookie]) => {
			if (cookie && cookie.value !== undefined) {
				this.cookies[name] = cookie.value;
			}
		});
	}

	private serializeCookies(): string {
		return Object.entries(this.cookies)
			.map(([name, value]) => `${name}=${value}`)
			.join("; ");
	}

	private resolveUrl(href: string): string {
		if (href.startsWith("http")) {
			return href;
		}

		if (href.startsWith("/")) {
			return `${BASE_URL}${href}`;
		}

		return `${BASE_URL}/${href}`;
	}

	private normalizeTitle(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	}

	private calculateTitleScore(expected: string, candidate: string): number {
		if (!expected || !candidate) {
			return 0;
		}

		if (expected === candidate) {
			return 1;
		}

		const expectedTokens = new Set(expected.split(" ").filter(Boolean));
		const candidateTokens = new Set(candidate.split(" ").filter(Boolean));

		if (expectedTokens.size === 0 || candidateTokens.size === 0) {
			return 0;
		}

		let intersection = 0;
		expectedTokens.forEach((token) => {
			if (candidateTokens.has(token)) {
				intersection += 1;
			}
		});

		const tokenScore = intersection / expectedTokens.size;
		const inclusionScore = candidate.includes(expected)
			? Math.min(0.95, expected.length / candidate.length)
			: 0;

		return Math.max(tokenScore, inclusionScore);
	}
}
