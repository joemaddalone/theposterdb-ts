import { expect, test, describe, beforeAll, vi } from "vitest";
import { ThePosterDbClient } from "./index";

describe("ThePosterDbClient", async () => {
	let client: ThePosterDbClient;
	beforeAll(() => {
		const username = import.meta.env.VITE_THEPOSTERDB_EMAIL;
		const password = import.meta.env.VITE_THEPOSTERDB_PASSWORD;
		if (!username || !password) {
			throw new Error("ThePosterDB credentials are required. Set VITE_THEPOSTERDB_EMAIL and VITE_THEPOSTERDB_PASSWORD.");
		}
		client = new ThePosterDbClient(username, password);
	});

	test('bad client', async () => {
		expect(() => new ThePosterDbClient("", "")).toThrow();
	});

	describe('login', () => {

		test("login", async () => {
			await client['login']();
			expect(client['loggedIn']).toBeTruthy();
		});

		test('extractCsrfToken', async () => {
			const response = await client['fetchWithSession']("https://theposterdb.com/search?term=The+Matrix&section=movies");
			const html = await response.text();
			const csrfToken = client['extractCsrfToken'](html);
			expect(csrfToken).toBeDefined();
		});

		test('ensureLoggedIn', async () => {
			await client['ensureLoggedIn']();
			expect(client['loggedIn']).toBeTruthy();
		});

		test('resetSession', async () => {
			await client['login']();
			expect(client['loggedIn']).toBeTruthy();
			await client['resetSession']();
			expect(client['loggedIn']).toBeFalsy();
		});
	});

	describe('search', () => {

		test('search 500', async () => {
			// @ts-ignore
			vi.spyOn(client, 'fetchWithSession').mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			await expect(client.search({ title: "The Matrix" })).rejects.toThrow();
			// @ts-ignore
			vi.restoreAllMocks();
		});

		test('search 401', async () => {
			// @ts-ignore
			vi.spyOn(client, 'fetchWithSession').mockResolvedValue({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
			});

			// wait for

			vi.spyOn(client, 'resetSession');
			// @ts-ignore
			vi.spyOn(client, 'ensureLoggedIn');
			vi.spyOn(client, 'search');

			await expect(client.search({ title: "The Matrix" }));
			await vi.waitFor(() => {
				expect(client['resetSession']).toHaveBeenCalled();
				expect(client['ensureLoggedIn']).toHaveBeenCalled();
				expect(client['search']).toHaveBeenCalled();
			});

			// @ts-ignore
			vi.restoreAllMocks();
		});

		test("search", async () => {
			const results = await client.search({
				title: "The Matrix",
			});
			expect(results).toHaveLength(18);
		});

		test("search with limit", async () => {
			const results = await client.search({
				title: "The Matrix",
				limit: 1,
			});
			expect(results).toHaveLength(1);
		});

		test("search with year", async () => {
			const results = await client.search({
				title: "The Matrix",
				year: 1999,
			});
			expect(results).toHaveLength(18);
		});

		test('normalizeTitle', async () => {
			const title = client['normalizeTitle']("THE!MATRIX");
			expect(title).toBe("the matrix");

		});

		test('calculateTitleScore', async () => {
			expect(client['calculateTitleScore']("", "")).toBe(0);
			expect(client['calculateTitleScore']("the matrix", "the matrix")).toBe(1);
			expect(client['calculateTitleScore']("the matrix", "the matrix:reloaded")).toBeCloseTo(0.5, 1);
		});

		test('buildQuery', async () => {
			const query = client['buildQuery']({
				title: "The Matrix",
				year: 1999,
			});
			expect(query).toBe("The Matrix (1999)");
		});

		test('buildSearchUrl', async () => {
			const url = client['buildSearchUrl']("The Matrix", "movie");
			expect(url).toBe("https://theposterdb.com/search?term=The+Matrix&section=movies");
		});

		test('buildHeaders', async () => {
			const headers = client['buildHeaders']();
			expect(headers).toHaveProperty("User-Agent");
		});

		test('extractSearchLinks', async () => {
			const response = await client['fetchWithSession']("https://theposterdb.com/search?term=The+Matrix&section=movies");
			const html = await response.text();
			const links = client['extractSearchLinks'](html);
			expect(links[0]).toHaveProperty("title");
			expect(links[0]).toHaveProperty("href");
			expect(links[0]).toHaveProperty("elementText");
		});

		test('selectBestMatch', async () => {
			const links = client['extractSearchLinks']("https://theposterdb.com/search?term=The+Matrix&section=movies");
			const bestMatch = client['selectBestMatch'](links, "The Matrix");
			expect(bestMatch).toBeDefined();
		});

		test('extractPosterLinks', async () => {
			const response = await client['fetchWithSession']("https://theposterdb.com/posters/632");
			const html = await response.text();
			const posters = await client['extractPosterLinks'](html, false, 5);
			expect(posters).toHaveLength(5);
		});
	});
});