# Bangumi 番组计划 for Inscura

Anime series and episodes, animated films, voice actors and creators from Bangumi.

## Install / 安装

1. Download the plugin ZIP from [Releases](https://github.com/InscuraApp/inscura-plugin-bangumi/releases).
2. In Inscura: **Settings → Plugins → Install from ZIP**.
3. Open [website authorization](https://inscura.app/auth/bangumi), approve Bangumi access, and copy the access token into the plugin's **Access token** setting.
4. Enable the plugin and select **Bangumi** as the scraper in your library/search.

No App ID or App Secret is distributed with the plugin. The website handles OAuth; no App update or custom callback is needed. The website shows the token's actual expiry. When it expires, authorize again and replace it. There is no automatic refresh or collection/progress synchronization.

**Privacy:** Bangumi currently includes basic account-read access on its consent screen even when only wiki-read is selected in the application settings. This plugin does **not** call `/v0/me` or any account/collection endpoint. Connection testing first verifies the OAuth grant via `POST https://bgm.tv/oauth/token_status`, discarding all returned data, then checks public wiki connectivity. Public wiki GET responses may be cached ahead of authentication and are not used as proof of token validity. OAuth token exchange may return an account identifier, which the website discards along with the refresh token.

简体中文：在官网授权，复制访问令牌，打开 Inscura「设置 → 插件 → 从 ZIP 安装」，粘贴令牌并启用。到期后重新授权。授权页的账户读取提示由 Bangumi 提供，插件不请求账户资料，也不读写收藏或观看进度。

## Settings

<!-- inscura:config:start -->
| Setting / 设置项 | Key | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| Access token / 访问令牌 | `apiKey` | password | yes | (empty) | Authorize at https://inscura.app/auth/bangumi, then paste the access token here. Reauthorize after it expires. No App ID or App Secret is required. / 在 https://inscura.app/auth/bangumi 完成授权，将访问令牌粘贴到这里。到期后重新授权，无需填写 App ID 或 App Secret。 |
| Include remote images / 返回远程图片 | `includeImages` | boolean | no | `true` | Return available poster, backdrop and photo URLs. Images are core assets; the recommended default is enabled. Source image terms still apply. / 返回可用的海报、背景图和照片地址。图片是核心资产，推荐默认开启。仍须遵守来源图片使用条款。 |

The scraping language is injected by Inscura as `ctx.config.language`; it is not a plugin setting.
<!-- inscura:config:end -->

## Supported metadata

- **TV:** anime TV/WEB/OVA/OAD subjects, names, description, date/year, score, aliases, tags, studios/network when present, poster, cast/crew, seasons, episode metadata and complete catalogs.
- **Media:** animated theatrical films (`platform=剧场版`), title/original title, summary, release date, score, poster, tags and cast/crew.
- **Actor:** real individuals only (voice actors and creators); names/aliases, biography, birthday when complete, gender, career and portrait. Companies, groups and fictional characters are excluded from person search.
- Posters and portraits are enabled by default. Bangumi's size variants describe the same source image, not additional artwork. Missing backdrops, trailers, galleries and episode stills are not invented.
- Source Chinese names are preferred for Chinese scraping languages, including the host codes `zh_CN`/`zh_TW` and standard `zh-CN`/`zh-TW`; otherwise original names are retained. The API does not translate metadata into five languages. Plugin settings and scrape-field labels do have English, Simplified Chinese, Traditional Chinese, Japanese and Korean text.

## Series and episode numbering

One Bangumi subject is one independent show; sequels are not merged. Main episodes map to season 1 using the subject-local `ep` value, **not** the cumulative `sort` value (e.g. `ep=1, sort=29` stays S01E01). SP episodes map to season 0 only when `sort` is a nonnegative integer. OP/ED entries are excluded. Fractional/duplicate numbering prevents that season from being advertised as a complete catalog.

`tvScope` is honored: details only for local episodes; catalogs contain all official numbered episodes in the requested seasons. An empty local season can receive a catalog but no episode/season details. Empty scope skips episode fetching. Unsupported season numbers are not inferred. Episode pagination must finish; errors never replace a catalog with an empty snapshot.

Search returns at most 20 eligible candidates from the first 50 upstream matches. Ratings remain on Bangumi's 0–10 scale. Episode duration is converted from seconds to integer minutes. The host controls retries, field selection, translation, downloads and persistence. Nested role translation and role/character persistence depend on the host build.

## Data source

Documentation reviewed: **2026-10-26**.

- [Official API](https://bangumi.github.io/api/)
- [Official OpenAPI schema](https://github.com/bangumi/api/blob/master/open-api/v0.yaml)
- [OAuth documentation](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md)
- [User-Agent recommendations](https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md)
- [Bangumi terms and attribution](https://bgm.tv/about/copyright)

The search APIs are marked experimental upstream. Requests use a versioned application User-Agent. HTTP 429 is reported without automatic retry. Source URLs are retained. See [ATTRIBUTION.md](ATTRIBUTION.md).

[bgm.res](https://github.com/JimHans/bgm.res) was reviewed to understand authorization and subject-based organization. This adapter is independently implemented from the official API contract; no bgm.res code or assets are included.

## Development

Node.js 18.13+; no package installation is needed. Run `npm test` for synthetic behavior regression. Fixtures contain synthetic data only.

Use the [official Inscura toolkit](https://github.com/InscuraApp/inscura-scraper-skill) to validate, run and package:

```sh
node "$SKILL_DIR/tools/inscura.mjs" validate .
node "$SKILL_DIR/tools/smoke.mjs" . tv Fixture --fixtures fixtures/api.json --config '{"apiKey":"fixture-private-token"}'
node "$SKILL_DIR/tools/smoke.mjs" . media Fixture --fixtures fixtures/api.json --config '{"apiKey":"fixture-private-token"}'
node "$SKILL_DIR/tools/smoke.mjs" . actor Fixture --fixtures fixtures/api.json --config '{"apiKey":"fixture-private-token"}'
node "$SKILL_DIR/tools/inscura.mjs" pack .
```

Real credentials must be supplied from a private file **outside this repository**, never through command-line literals or committed fixtures.

## Verification

Version 0.0.1 includes host underscore-locale compatibility and OAuth token-status validation. The release version was reset to 0.0.1; scraper behavior is unchanged from the verified implementation.

| Level | Status | Evidence / remaining gap |
| --- | --- | --- |
| Static | passed | Manifest, exports and sandbox validation. |
| Fixtures | passed | 40 regression tests and three capability chains. |
| Live API | passed | Authorized real-service checks on 2026-10-26, before the version reset. |
| In-app | partial | macOS development-build checks below; the repackaged 0.0.1 archive has not been reinstalled in the App. |

- Static manifest/provider/field/export/sandbox validation: passed.
- Synthetic behavior regression: 40 tests passed, covering all three capabilities, defaults/image-off, missing data, errors, provider/type boundaries and TV scope/catalogs.
- Official toolkit fixture search → detail chains: passed for media, TV and actor.
- Live authenticated plugin chains: passed for Frieren (subject 400602), Your Name (subject 160209) and Kana Hanazawa (person 4765), using user-authorized OAuth on 2026-10-26. No profile or collection endpoint was called.
- Images: TV/film posters and person portrait returned HTTP 200 and decoded successfully with macOS sips; the native App preview downloader also retrieved all three into the isolated test-library cache and the saved bytes decoded successfully.
- Inscura 0.1.1, macOS x86_64 development build: ZIP installation, enable/connection test and all three real search → detail chains passed through the Tauri Bridge and native QuickJS runtime. Chinese titles were verified with the host’s `zh_CN` setting and translation disabled. Second-season subject 515759 mapped its first episode to S01E01 (not episode 29).
- Additional isolated-library verification covered five anime subjects (Frieren, Frieren season 2, Attack on Titan, Bocchi the Rock! and Demon Slayer), two films (Your Name and Spirited Away), 101 catalog episodes, 10 bound episode files and 21 people. Show/season posters, actor portraits and cast links were saved and displayed. Twelve generated eight-second test videos supplied episode/film previews; these previews are local frame captures, not Bangumi episode stills.
- Real user media, Windows runtime and paid translation: not run. Temporary libraries, generated videos, screenshots and private credentials were removed after verification.

The final archive is extracted and validated separately, including fixture search → detail checks for all three capabilities. Its SHA-256 is supplied with the release.
