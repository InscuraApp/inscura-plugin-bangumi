/* Bangumi official API adapter. QuickJS / apiVersion 1; no Node dependencies. */
'use strict';
const PLUGIN_ID = 'inscura-plugin-bangumi';
const PROVIDER = 'bangumi';
const API = 'https://api.bgm.tv/v0';
const UA = 'InscuraApp/inscura-plugin-bangumi/1.0.0 (https://github.com/InscuraApp/inscura-plugin-bangumi)';
const AUTH_HELP = 'Authorize again at https://inscura.app/auth/bangumi and paste your access token.';
const str = value => typeof value === 'string' ? value.trim() : '';
const clean = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const sid = value => integer(Number(value)) && Number(value) > 0 ? String(value) : '';
const date = value => {
  const text = str(value);
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text) || Number(text.slice(0, 4)) < 1900) return undefined;
  const [y, m = 1, d = 1] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? text : undefined;
};
const rating = value => typeof value === 'number' && value > 0 && value <= 10 ? value : undefined;
const unique = values => [...new Set(values.filter(Boolean))];
const localized = (item, ctx) => (/^zh(?:-|$)/i.test(str(ctx.config.language)) && str(item.name_cn)) || str(item.name) || str(item.name_cn);
const enabledImages = ctx => ctx.config.includeImages !== false;
const image = (item, ctx) => {
  if (!enabledImages(ctx)) return undefined;
  const images = item && item.images;
  const url = images && (images.large || images.medium || images.common || images.small || images.grid);
  return typeof url === 'string' && /^https:\/\//i.test(url) && !/[\s<>]/.test(url) ? url : undefined;
};
const infoValues = (item, key) => {
  const field = (Array.isArray(item.infobox) ? item.infobox : []).find(x => x && x.key === key);
  const value = field && field.value;
  return unique(typeof value === 'string' ? [str(value)] : Array.isArray(value) ? value.map(x => str(x && x.v)) : []);
};
function identity(provider, id) {
  if (provider !== PROVIDER || !sid(id)) throw new Error('Unsupported Bangumi provider or ID.');
}
function selected(ctx) {
  if (ctx.request.provider && ctx.request.provider !== PROVIDER) throw new Error('Unsupported Bangumi provider.');
}
async function request(ctx, path, body) {
  const token = str(ctx.config.apiKey);
  if (!token || /[\s\x00-\x1f\x7f]/.test(token)) throw new Error('Missing or invalid access token. ' + AUTH_HELP);
  let response;
  try {
    response = await ctx.fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', 'User-Agent': UA, Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeoutMs: 30000,
    });
  } catch (_) { throw new Error('Bangumi network request failed. Please try again later.'); }
  if (response.status === 401 || response.status === 403) throw new Error('Bangumi authorization failed. ' + AUTH_HELP);
  if (response.status === 429) throw new Error('Bangumi rate limit reached. Please try again later.');
  if (response.status === 404) throw new Error('Bangumi item was not found or is not accessible to this account.');
  if (!response.ok) throw new Error('Bangumi request failed (HTTP ' + response.status + ').');
  try { return await response.json(); } catch (_) { throw new Error('Bangumi returned invalid JSON.'); }
}
function page(data) {
  if (!data || !Array.isArray(data.data) || !integer(data.total)) throw new Error('Invalid Bangumi page response.');
  return data;
}
function entity(data, id, type) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || sid(data.id) !== String(id)
    || (type !== undefined && data.type !== type) || !str(data.name || data.name_cn)) throw new Error('Invalid Bangumi item response.');
  return data;
}
const isMovie = subject => subject.platform === '剧场版';
const isTv = subject => ['TV', 'WEB', 'Web', 'OVA', 'OAD'].includes(subject.platform);
async function subjects(keyword, ctx, movie) {
  selected(ctx);
  if (!str(keyword)) return [];
  const filter = { type: [2] };
  const y = ctx.request.year;
  if (Number.isInteger(y) && y >= 1900 && y <= 9998) filter.air_date = ['>=' + y + '-01-01', '<' + (y + 1) + '-01-01'];
  const data = page(await request(ctx, '/search/subjects?limit=50&offset=0', { keyword: str(keyword), sort: 'match', filter }));
  return data.data.filter(x => x && x.type === 2 && sid(x.id) && localized(x, ctx) && (movie ? isMovie(x) : isTv(x))).slice(0, 20);
}
function searchSubject(subject, ctx, movie) {
  const common = { id: String(subject.id), provider: PROVIDER, title: localized(subject, ctx), originalTitle: str(subject.name) || undefined };
  if (movie) return clean({ ...common, releaseDate: date(subject.date), score: rating(subject.rating && subject.rating.score), thumbUrl: image(subject, ctx) });
  return clean({ ...common, firstAired: date(subject.date), year: date(subject.date) ? Number(subject.date.slice(0, 4)) : undefined,
    overview: str(subject.summary) || undefined, posterUrl: image(subject, ctx), rating: rating(subject.rating && subject.rating.score),
    voteCount: integer(subject.rating && subject.rating.total) ? subject.rating.total : undefined, adult: subject.nsfw === true });
}
async function credits(id, ctx) {
  // Two bounded bulk requests; no individual person/character fan-out.
  const persons = await request(ctx, '/subjects/' + id + '/persons');
  const characters = await request(ctx, '/subjects/' + id + '/characters');
  if (!Array.isArray(persons) || !Array.isArray(characters)) throw new Error('Invalid Bangumi credits response.');
  const castMap = new Map();
  for (const character of characters) {
    for (const actor of Array.isArray(character && character.actors) ? character.actors : []) {
      if (!sid(actor.id) || !str(actor.name)) continue;
      let credit = castMap.get(String(actor.id));
      if (!credit) {
        credit = clean({ name: actor.name, scraperPluginId: PLUGIN_ID, providerId: PROVIDER, providerActorId: String(actor.id),
          profileUrl: image(actor, ctx), roles: [], sortOrder: castMap.size });
        castMap.set(String(actor.id), credit);
      }
      const name = str(character.name);
      if (name && !credit.roles.some(role => role.character === name)) credit.roles.push({ slug: 'actor', name: 'Voice actor', character: name });
    }
  }
  const crewMap = new Map();
  const roleSlugs = { '导演': 'director', '脚本': 'writer', '原作': 'writer', '系列构成': 'writer', '音乐': 'composer', '人物设定': 'character-designer', '作画监督': 'animation-director', '总作画监督': 'animation-director', '美术监督': 'art-director', '制片人': 'producer', '制作人': 'producer', '音响监督': 'sound-director' };
  for (const person of persons) {
    if (person.type !== 1 || !sid(person.id) || !str(person.name)) continue;
    let credit = crewMap.get(String(person.id));
    if (!credit) {
      credit = clean({ name: person.name, scraperPluginId: PLUGIN_ID, providerId: PROVIDER, providerActorId: String(person.id),
        profileUrl: image(person, ctx), roles: [], sortOrder: crewMap.size });
      crewMap.set(String(person.id), credit);
    }
    const job = str(person.relation);
    if (job && !credit.roles.some(role => role.job === job)) credit.roles.push({ slug: roleSlugs[job] || 'crew', name: job, job });
  }
  return { cast: [...castMap.values()], crew: [...crewMap.values()] };
}
async function detail(provider, id, ctx, movie) {
  identity(provider, id);
  const subject = entity(await request(ctx, '/subjects/' + id), id, 2);
  if (movie ? !isMovie(subject) : !isTv(subject)) throw new Error('This Bangumi item does not match the selected media type.');
  const people = await credits(id, ctx);
  const tags = unique((Array.isArray(subject.tags) ? subject.tags : []).map(x => str(x && x.name)));
  const aliases = infoValues(subject, '别名');
  const common = { id: String(id), provider, title: localized(subject, ctx), originalTitle: str(subject.name) || undefined,
    sourceUrl: 'https://bgm.tv/subject/' + id, ...people };
  if (movie) return clean({ ...common, summary: str(subject.summary) || undefined, releaseDate: date(subject.date),
    score: rating(subject.rating && subject.rating.score), bigThumbUrl: image(subject, ctx), tags: tags.length ? tags : undefined });
  const value = clean({ ...common, description: str(subject.summary) || undefined, firstAired: date(subject.date),
    year: date(subject.date) ? Number(subject.date.slice(0, 4)) : undefined, rating: rating(subject.rating && subject.rating.score),
    poster: image(subject, ctx), aliases: aliases.length ? aliases : undefined, tvTag: tags.length ? tags : undefined,
    tvStudio: infoValues(subject, '动画制作').length ? infoValues(subject, '动画制作') : undefined,
    network: infoValues(subject, '播放电视台').length ? infoValues(subject, '播放电视台') : undefined });
  return Object.assign(value, await episodeData(subject, ctx));
}
async function episodeData(subject, ctx) {
  const scope = ctx.request.tvScope;
  if (scope && (!Array.isArray(scope.seasons) || scope.seasons.length === 0)) return {};
  const wanted = scope ? scope.seasons.filter(x => x.seasonNumber === 0 || x.seasonNumber === 1) : null;
  if (wanted && wanted.length === 0) return {};
  const rows = []; let offset = 0; let total;
  do {
    const data = page(await request(ctx, '/episodes?subject_id=' + subject.id + '&limit=200&offset=' + offset));
    if (total !== undefined && data.total !== total) throw new Error('Bangumi episode catalog changed during pagination. Please retry.');
    total = data.total;
    if (total > 10000 || (data.data.length === 0 && offset < total) || offset + data.data.length > total) throw new Error('Incomplete Bangumi episode catalog.');
    rows.push(...data.data); offset += data.data.length;
  } while (offset < total);
  const groups = { 0: [], 1: [] }; const complete = { 0: true, 1: true };
  for (const row of rows) {
    if (!row || (row.type !== 0 && row.type !== 1)) continue; // OP/ED are not local episodes.
    if (Number(row.subject_id) !== Number(subject.id)) throw new Error('Bangumi episode identity mismatch.');
    const season = row.type === 0 ? 1 : 0;
    const number = row.type === 0 ? row.ep : row.sort;
    if (!integer(number) || (season === 1 && number === 0) || groups[season].some(x => x.episodeNumber === number)) {
      complete[season] = false; continue; // Never advertise a partial catalog as complete.
    }
    groups[season].push(clean({ seasonNumber: season, episodeNumber: number, title: localized(row, ctx) || undefined,
      originalTitle: str(row.name) || undefined, description: str(row.desc) || undefined, releaseDate: date(row.airdate),
      runtime: Number.isFinite(row.duration_seconds) && row.duration_seconds >= 60 ? Math.round(row.duration_seconds / 60) : undefined }));
  }
  const seasons = [], episodes = [], episodeCatalogs = [];
  for (const season of [1, 0]) {
    const requested = wanted && wanted.find(x => x.seasonNumber === season);
    if (wanted && !requested) continue;
    const all = groups[season].sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (!wanted && season === 0 && !all.length) continue;
    if (complete[season]) episodeCatalogs.push({ seasonNumber: season, episodes: all.map(x => clean({ episodeNumber: x.episodeNumber, title: x.title })) });
    if (requested && (!Array.isArray(requested.episodeNumbers) || requested.episodeNumbers.length === 0)) continue;
    seasons.push(clean({ seasonNumber: season, title: season === 1 ? localized(subject, ctx) : undefined,
      episodeCount: complete[season] ? all.length : undefined, poster: image(subject, ctx) }));
    episodes.push(...all.filter(x => !requested || requested.episodeNumbers.includes(x.episodeNumber)));
  }
  return { seasons, episodes, episodeCatalogs };
}
module.exports = {
  async test(ctx) {
    // Bangumi validates every supplied Bearer token, including on public reads.
    // Verify wiki connectivity without requesting the user's profile (/me).
    entity(await request(ctx, '/subjects/400602'), '400602', 2);
    return { ok: true };
  },
  async searchMedia(keyword, ctx) { return (await subjects(keyword, ctx, true)).map(x => searchSubject(x, ctx, true)); },
  async searchTv(keyword, ctx) { return (await subjects(keyword, ctx, false)).map(x => searchSubject(x, ctx, false)); },
  async getMediaDetail(provider, id, ctx) { return detail(provider, id, ctx, true); },
  async getTvDetail(provider, id, ctx) { return detail(provider, id, ctx, false); },
  async searchActors(keyword, ctx) {
    selected(ctx);
    if (!str(keyword)) return [];
    const data = page(await request(ctx, '/search/persons?limit=50&offset=0', { keyword: str(keyword) }));
    return data.data.filter(x => x && x.type === 1 && sid(x.id) && str(x.name)).slice(0, 20)
      .map(x => clean({ id: String(x.id), provider: PROVIDER, name: x.name, avatar: image(x, ctx) }));
  },
  async getActorDetail(provider, id, ctx) {
    identity(provider, id);
    const person = entity(await request(ctx, '/persons/' + id), id, 1);
    const aliases = infoValues(person, '别名');
    let birthday;
    if (integer(person.birth_year) && person.birth_year >= 1900 && integer(person.birth_mon) && integer(person.birth_day)) {
      birthday = date(person.birth_year + '-' + String(person.birth_mon).padStart(2, '0') + '-' + String(person.birth_day).padStart(2, '0'));
    }
    const gender = infoValues(person, '性别')[0];
    const skills = unique((Array.isArray(person.career) ? person.career : []).map(str));
    return clean({ id: String(id), provider, name: person.name, description: str(person.summary) || undefined, birthday,
      aliases: aliases.length ? aliases : undefined, gender: gender || undefined,
      avatar: image(person, ctx), skills: skills.length ? skills : undefined, sourceUrl: 'https://bgm.tv/person/' + id });
  },
};
