import express, { type NextFunction, type Request, type Response } from "express";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const port = Number(process.env.PORT || 3020);
const dbFile = process.env.DB_FILE || path.resolve("data/pugotilist.db");
const publicDir = process.env.PUBLIC_DIR || path.resolve("public");
const profileUrl = process.env.PUGOTILAB_PROFILE_URL || "http://pugotilab-auth:8080/auth/api/profile";
const loginUrl = process.env.PUGOTILAB_LOGIN_URL || "https://pugotilab.com/auth";
const jellyfinDbFile = process.env.JELLYFIN_DB_FILE || "";
const jellyfinServerId = process.env.JELLYFIN_SERVER_ID || "230f9c38281e4a15ae124ac21e70dbd9";
const publicOrigin = process.env.PUBLIC_ORIGIN || "https://list.pugotilab.com";
const steamApiKey = process.env.STEAM_WEB_API_KEY || "";
const xboxClientId = process.env.XBOX_CLIENT_ID || "";
const xboxClientSecret = process.env.XBOX_CLIENT_SECRET || "";
const xboxRedirectUri = process.env.XBOX_REDIRECT_URI || `${publicOrigin}/api/integrations/xbox/callback`;
const xboxTokenEncryptionKey = process.env.XBOX_TOKEN_ENCRYPTION_KEY || "";
const steamGuideCache = new Map<string,{expiresAt:number,data:any}>();
const tasksApiUrl = process.env.PUGOTITASKS_API_URL || "http://pugotitasks:3010/api/integrations/v1";
const tasksTokenFile = path.join(path.dirname(dbFile), "pugotitasks-token");
const tasksApiToken = process.env.PUGOTITASKS_API_TOKEN || (fs.existsSync(tasksTokenFile) ? fs.readFileSync(tasksTokenFile,"utf8").trim() : "");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

async function mapWithConcurrency<T, R>(values: T[], limit: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), values.length) }, () => run()));
  return results;
}

const db = new Database(dbFile);
const jellyfinCacheFile = path.join(path.dirname(dbFile), "jellyfin-cache.db");
let jellyfinDb: Database.Database | null = null;
let jellyfinCacheMtime = 0;
let jellyfinLastCheck = 0;
function getJellyfinDb() {
  if (!jellyfinDbFile || !fs.existsSync(jellyfinDbFile)) return null;
  try {
    const now = Date.now();
    if (jellyfinDb && now - jellyfinLastCheck < 5000) return jellyfinDb;
    jellyfinLastCheck = now;
    const sourceMtime = fs.statSync(jellyfinDbFile).mtimeMs;
    if (!jellyfinDb || sourceMtime !== jellyfinCacheMtime) {
      fs.copyFileSync(jellyfinDbFile, jellyfinCacheFile);
      jellyfinDb?.close();
      jellyfinDb = new Database(jellyfinCacheFile, { readonly:true, fileMustExist:true });
      jellyfinCacheMtime = sourceMtime;
    }
    return jellyfinDb;
  } catch { return jellyfinDb; }
}
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS library_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('igdb','tmdb')),
    media_type TEXT NOT NULL CHECK(media_type IN ('game','movie','tv')),
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    release_year TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','abandoned')),
    rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 10),
    favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1)),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider, media_type, external_id)
  );
  CREATE TABLE IF NOT EXISTS custom_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
  );
  CREATE TABLE IF NOT EXISTS custom_list_items (
    list_id INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(list_id, item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_library_user_status ON library_items(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_library_user_favorite ON library_items(user_id, favorite);
  CREATE TABLE IF NOT EXISTS overview_translations (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    language TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(provider, external_id, language)
  );
  CREATE TABLE IF NOT EXISTS user_steam_connections (
    user_id TEXT PRIMARY KEY,
    steam_id_64 TEXT NOT NULL UNIQUE,
    connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS steam_openid_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_xbox_connections (
    user_id TEXT PRIMARY KEY,
    xuid TEXT NOT NULL UNIQUE,
    gamertag TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS xbox_oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    return_base TEXT NOT NULL DEFAULT ''
  );
`);
const libraryColumns = db.prepare("PRAGMA table_info(library_items)").all() as { name:string }[];
if (!libraryColumns.some(column=>column.name==="play_platform")) db.exec("ALTER TABLE library_items ADD COLUMN play_platform TEXT NOT NULL DEFAULT ''");
if (!libraryColumns.some(column=>column.name==="creator_name")) db.exec("ALTER TABLE library_items ADD COLUMN creator_name TEXT NOT NULL DEFAULT ''");
if (!libraryColumns.some(column=>column.name==="content_category")) db.exec("ALTER TABLE library_items ADD COLUMN content_category TEXT NOT NULL DEFAULT ''");
if (!libraryColumns.some(column=>column.name==="steam_app_id")) db.exec("ALTER TABLE library_items ADD COLUMN steam_app_id TEXT NOT NULL DEFAULT ''");
if (!libraryColumns.some(column=>column.name==="achievement_total")) db.exec("ALTER TABLE library_items ADD COLUMN achievement_total INTEGER NOT NULL DEFAULT 0");
if (!libraryColumns.some(column=>column.name==="achievement_unlocked")) db.exec("ALTER TABLE library_items ADD COLUMN achievement_unlocked INTEGER NOT NULL DEFAULT 0");
if (!libraryColumns.some(column=>column.name==="achievements_synced_at")) db.exec("ALTER TABLE library_items ADD COLUMN achievements_synced_at TEXT NOT NULL DEFAULT ''");
if (!libraryColumns.some(column=>column.name==="work_situation")) db.exec("ALTER TABLE library_items ADD COLUMN work_situation TEXT NOT NULL DEFAULT ''");
const steamStateColumns=db.prepare("PRAGMA table_info(steam_openid_states)").all() as {name:string}[];
if(!steamStateColumns.some(column=>column.name==="return_base"))db.exec("ALTER TABLE steam_openid_states ADD COLUMN return_base TEXT NOT NULL DEFAULT ''");
const customListColumns=db.prepare("PRAGMA table_info(custom_lists)").all() as {name:string}[];
if(!customListColumns.some(column=>column.name==="icon"))db.exec("ALTER TABLE custom_lists ADD COLUMN icon TEXT NOT NULL DEFAULT 'playlist_play'");
if(!customListColumns.some(column=>column.name==="color"))db.exec("ALTER TABLE custom_lists ADD COLUMN color TEXT NOT NULL DEFAULT '#3b82f6'");
if(!customListColumns.some(column=>column.name==="category"))db.exec("ALTER TABLE custom_lists ADD COLUMN category TEXT NOT NULL DEFAULT 'mixed'");
const customItemColumns=db.prepare("PRAGMA table_info(custom_list_items)").all() as {name:string}[];
if(!customItemColumns.some(column=>column.name==="task_id"))db.exec("ALTER TABLE custom_list_items ADD COLUMN task_id TEXT NOT NULL DEFAULT ''");

async function tasksApi(pathname:string,options:RequestInit={}){
  if(!tasksApiToken)throw new Error("Integração com Pugotitasks não configurada.");
  const response=await fetch(`${tasksApiUrl}${pathname}`,{...options,headers:{authorization:`Bearer ${tasksApiToken}`,"content-type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(10000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||"Pugotitasks indisponível.");
  return body as any;
}
function xboxCipherKey(){if(!xboxTokenEncryptionKey)throw new Error("Integração Xbox sem chave de proteção configurada.");return crypto.createHash("sha256").update(xboxTokenEncryptionKey).digest()}
function encryptXboxToken(value:string){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",xboxCipherKey(),iv);const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`}
function decryptXboxToken(value:string){const [iv,tag,data]=value.split(".");if(!iv||!tag||!data)throw new Error("Token Xbox inválido.");const decipher=crypto.createDecipheriv("aes-256-gcm",xboxCipherKey(),Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8")}
async function xboxMicrosoftToken(params:URLSearchParams){const response=await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:params,signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));if(!response.ok||!body.access_token)throw new Error("A Microsoft não autorizou a conexão Xbox.");return body as {access_token:string;refresh_token?:string}}
async function xboxUserToken(accessToken:string){const response=await fetch("https://user.auth.xboxlive.com/user/authenticate",{method:"POST",headers:{"content-type":"application/json","x-xbl-contract-version":"1"},body:JSON.stringify({RelyingParty:"http://auth.xboxlive.com",TokenType:"JWT",Properties:{AuthMethod:"RPS",SiteName:"user.auth.xboxlive.com",RpsTicket:`d=${accessToken}`}}),signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));if(!response.ok||!body.Token||!body.DisplayClaims?.xui?.[0]?.uhs)throw new Error("A conta Microsoft não possui uma identidade Xbox utilizável.");return body as {Token:string;DisplayClaims:{xui:Array<{uhs:string;xid?:string}>}}
}
async function xboxSessionFromAccessToken(accessToken:string){const user=await xboxUserToken(accessToken);const response=await fetch("https://xsts.auth.xboxlive.com/xsts/authorize",{method:"POST",headers:{"content-type":"application/json","x-xbl-contract-version":"1"},body:JSON.stringify({Properties:{SandboxId:"RETAIL",UserTokens:[user.Token]},RelyingParty:"http://xboxlive.com",TokenType:"JWT"}),signal:AbortSignal.timeout(15000)});const body=await response.json().catch(()=>({}));if(!response.ok||!body.Token||!body.DisplayClaims?.xui?.[0]?.xid||!body.DisplayClaims?.xui?.[0]?.uhs)throw new Error("O Xbox não autorizou os serviços da conta.");const claim=body.DisplayClaims.xui[0];return {authorization:`XBL3.0 x=${claim.uhs};${body.Token}`,xuid:String(claim.xid),token:body.Token,uhs:String(claim.uhs)} }
async function xboxProfile(session:{authorization:string;xuid:string}){const response=await fetch("https://profile.xboxlive.com/users/batch/profile/settings",{method:"POST",headers:{authorization:session.authorization,"content-type":"application/json","x-xbl-contract-version":"2"},body:JSON.stringify({userIds:[session.xuid],settings:["GameDisplayName"]}),signal:AbortSignal.timeout(12000)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error("Não foi possível carregar o perfil Xbox.");const profile=body.profileUsers?.[0];return {xuid:session.xuid,gamertag:String(profile?.settings?.find((setting:any)=>setting.id==="GameDisplayName")?.value||"")}}
async function createTasksLink(item:any){
  const prefix=item.media_type==="game"?"Jogar":item.content_category==="anime"?"Assistir anime":item.media_type==="tv"?"Assistir série":"Assistir";
  const body=await tasksApi("/tasks",{method:"POST",body:JSON.stringify({title:`${prefix} - ${item.title}`,folderName:"Assistir mais tarde",notes:`Criado pelo Pugotilist · ${item.provider}:${item.external_id}`})});
  return String(body.task.id);
}
async function syncTasksCompletion(userId:string){
  if(!tasksApiToken)return 0;
  const linked=db.prepare(`SELECT DISTINCT li.item_id,li.task_id,i.status FROM custom_list_items li
    JOIN custom_lists l ON l.id=li.list_id JOIN library_items i ON i.id=li.item_id
    WHERE l.user_id=? AND li.task_id<>''`).all(userId) as any[];
  const body=await tasksApi("/tasks?filter=all&limit=200");
  const tasks=body.tasks||[],remote=new Map(tasks.map((task:any)=>[String(task.id),Boolean(task.completed)]));
  const normalized=(value:string)=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").trim();
  const items=db.prepare("SELECT id,title,status,rating,notes FROM library_items WHERE user_id=?").all(userId) as any[];
  const byTitle=new Map(items.map(item=>[normalized(item.title),item]));
  const legacy=tasks.filter((task:any)=>task.folder?.name?.toLocaleLowerCase("pt-BR")==="assistir mais tarde").map((task:any)=>{
    const title=String(task.title||"").replace(/^(assistir(?: anime| série)?|jogar)\s*-\s*/i,"");
    const item=byTitle.get(normalized(title));return item?{item_id:item.id,task_id:String(task.id),status:item.status}:null;
  }).filter(Boolean) as any[];
  const mappings=[...linked,...legacy.filter(link=>!linked.some(saved=>saved.item_id===link.item_id))];
  const update=db.prepare("UPDATE library_items SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?");
  let changed=0;
  db.transaction(()=>{for(const link of mappings){if(!remote.has(String(link.task_id)))continue;const item=items.find(candidate=>candidate.id===link.item_id),reviewed=Number(item?.rating)>0||String(item?.notes||"").trim();const status=remote.get(String(link.task_id))||reviewed?"completed":"planned";if(link.status!==status){update.run(status,link.item_id,userId);changed++}}})();
  return changed;
}

type Profile = { id?: string | number; userId?: string | number; username: string; nickname?: string; displayName?: string; avatarUrl?: string; role?: string };
type AuthedRequest = Request & { profile?: Profile; userId?: string };

async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const response = await fetch(profileUrl, { headers: { cookie: req.headers.cookie || "", accept: "application/json" } });
    if (!response.ok) return res.status(401).json({ error: "Entre com sua conta Pugotilab.", loginUrl });
    const body = await response.json() as Profile | { profile: Profile };
    const profile = "profile" in body ? body.profile : body;
    const id = profile.id ?? profile.userId ?? profile.username;
    if (!id || !profile.username) return res.status(401).json({ error: "Perfil Pugotilab inválido.", loginUrl });
    req.profile = profile;
    req.userId = String(id);
    next();
  } catch {
    res.status(503).json({ error: "A identidade Pugotilab está temporariamente indisponível." });
  }
}

let igdbToken = "";
let igdbTokenExpiresAt = 0;
async function getIgdbToken() {
  if (igdbToken && Date.now() < igdbTokenExpiresAt - 60_000) return igdbToken;
  const clientId = process.env.IGDB_CLIENT_ID;
  const secret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !secret) return "";
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", secret);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) throw new Error("Falha ao autenticar o catálogo IGDB.");
  const data = await response.json() as { access_token: string; expires_in: number };
  igdbToken = data.access_token;
  igdbTokenExpiresAt = Date.now() + data.expires_in * 1000;
  return igdbToken;
}

function imageUrl(url?: string, size = "cover_big") { return url ? `https:${url.replace(/t_[^/]+/, `t_${size}`)}` : ""; }
function yearFromTimestamp(value?: number) { return value ? String(new Date(value * 1000).getUTCFullYear()) : ""; }

async function searchIgdb(query: string) {
  const token = await getIgdbToken();
  const clientId = process.env.IGDB_CLIENT_ID || "";
  if (!token) return [];
  const body = `search ${JSON.stringify(query)}; fields name,summary,cover.url,artworks.url,screenshots.url,first_release_date,genres.name,platforms.name; where version_parent = null; limit 30;`;
  const response = await fetch("https://api.igdb.com/v4/games", { method: "POST", headers: { "Client-ID": clientId, Authorization: `Bearer ${token}`, "content-type": "text/plain" }, body });
  if (!response.ok) throw new Error("A pesquisa de jogos não respondeu.");
  const games = await response.json() as any[];
  return games
    .filter(game => game.cover?.url || game.artworks?.[0]?.url || game.screenshots?.[0]?.url)
    .slice(0, 18)
    .map(game => ({ provider: "igdb", mediaType: "game", externalId: String(game.id), title: game.name, overview: game.summary || "Sinopse indisponível.", posterUrl: imageUrl(game.cover?.url || game.artworks?.[0]?.url || game.screenshots?.[0]?.url), backdropUrl: imageUrl(game.artworks?.[0]?.url || game.screenshots?.[0]?.url), releaseYear: yearFromTimestamp(game.first_release_date), genres: (game.genres || []).map((v: any) => v.name), platforms: (game.platforms || []).map((v: any) => v.name) }));
}

async function searchTmdb(query: string, type: "movie" | "tv") {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return [];
  const url = new URL(`https://api.themoviedb.org/3/search/${type}`);
  url.searchParams.set("query", query);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("include_adult", "false");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) throw new Error("A pesquisa de filmes e séries não respondeu.");
  const data = await response.json() as { results: any[] };
  return data.results.slice(0, 18).map(item => ({ provider: "tmdb", mediaType: type, contentCategory:type==="tv" && (item.genre_ids||[]).includes(16) && (item.origin_country||[]).includes("JP") ? "anime" : type, externalId: String(item.id), title: item.title || item.name, overview: item.overview || "Sinopse indisponível.", posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "", backdropUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : "", releaseYear: (item.release_date || item.first_air_date || "").slice(0, 4), score: item.vote_average || 0 }));
}

async function recommendIgdb(ids: string[]) {
  if (!ids.length) return [];
  const token = await getIgdbToken();
  const clientId = process.env.IGDB_CLIENT_ID || "";
  if (!token) return [];
  const body = `fields similar_games.name,similar_games.cover.url,similar_games.artworks.url,similar_games.screenshots.url,similar_games.first_release_date,similar_games.genres.name,similar_games.total_rating; where id = (${ids.map(Number).filter(Boolean).join(",")}); limit ${ids.length};`;
  const response = await fetch("https://api.igdb.com/v4/games", { method:"POST", headers:{ "Client-ID":clientId, Authorization:`Bearer ${token}`, "content-type":"text/plain" }, body });
  if (!response.ok) return [];
  const seeds:any[] = await response.json();
  return seeds.flatMap(seed => seed.similar_games || []).filter((game:any) => game.cover?.url || game.artworks?.[0]?.url).map((game:any) => ({ provider:"igdb", mediaType:"game", externalId:String(game.id), title:game.name, posterUrl:imageUrl(game.cover?.url || game.artworks?.[0]?.url || game.screenshots?.[0]?.url), releaseYear:yearFromTimestamp(game.first_release_date), genres:(game.genres||[]).map((v:any)=>v.name), score:game.total_rating||0 }));
}

async function recommendTmdb(seeds: { external_id:string; media_type:"movie"|"tv" }[], contentCategory: "movie"|"tv"|"anime") {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) return [];
  const lists = await mapWithConcurrency(seeds, 2, async seed => {
    const url = new URL(`https://api.themoviedb.org/3/${seed.media_type}/${seed.external_id}/recommendations`);
    url.searchParams.set("language", "pt-BR");
    const response = await fetch(url, { headers:{ Authorization:`Bearer ${token}`, accept:"application/json" } });
    if (!response.ok) return [];
    const data:any = await response.json();
    return (data.results||[]).slice(0,12)
      .filter((item:any)=>contentCategory!=="anime" || ((item.genre_ids||[]).includes(16) && (item.origin_country||[]).includes("JP")))
      .map((item:any) => ({ provider:"tmdb", mediaType:seed.media_type, contentCategory, externalId:String(item.id), title:item.title||item.name, overview:item.overview||"Sinopse indisponível.", posterUrl:item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:"", backdropUrl:item.backdrop_path?`https://image.tmdb.org/t/p/w1280${item.backdrop_path}`:"", releaseYear:(item.release_date||item.first_air_date||"").slice(0,4), score:item.vote_average||0 }));
  });
  return lists.flat();
}

function translationChunks(text: string) {
  const chunks: string[] = [];
  let current = "";
  for (const word of text.trim().split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (Buffer.byteLength(candidate, "utf8") > 430 && current) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translatedOverview(provider: string, externalId: string, original: string) {
  if (!original || original === "Sinopse indisponível.") return original;
  const cached = db.prepare("SELECT translated_text FROM overview_translations WHERE provider=? AND external_id=? AND language='pt-BR'").get(provider, externalId) as { translated_text?: string } | undefined;
  if (cached?.translated_text) return cached.translated_text;
  try {
    const translated: string[] = [];
    for (const chunk of translationChunks(original)) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", chunk);
      url.searchParams.set("langpair", "en|pt-BR");
      url.searchParams.set("mt", "1");
      const response = await fetch(url, { headers:{ accept:"application/json" }, signal:AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Tradutor indisponível");
      const body:any = await response.json();
      const text = String(body.responseData?.translatedText || "").trim();
      if (!text || Number(body.responseStatus || 200) >= 400) throw new Error("Tradução inválida");
      translated.push(text);
    }
    const result = translated.join(" ");
    db.prepare("INSERT INTO overview_translations(provider,external_id,language,translated_text) VALUES(?,?,'pt-BR',?) ON CONFLICT(provider,external_id,language) DO UPDATE SET translated_text=excluded.translated_text,updated_at=CURRENT_TIMESTAMP").run(provider, externalId, result);
    return result;
  } catch {
    return original;
  }
}

async function detailsIgdb(id: string) {
  const token = await getIgdbToken();
  const clientId = process.env.IGDB_CLIENT_ID || "";
  if (!token) throw new Error("O catálogo de jogos não está configurado.");
  const body = `fields name,summary,storyline,cover.url,artworks.url,screenshots.url,first_release_date,genres.name,platforms.name,game_modes.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,total_rating,total_rating_count,external_games.external_game_source.name,external_games.uid; where id = ${Number(id)}; limit 1;`;
  const response = await fetch("https://api.igdb.com/v4/games", { method: "POST", headers: { "Client-ID": clientId, Authorization: `Bearer ${token}`, "content-type": "text/plain" }, body });
  if (!response.ok) throw new Error("Não foi possível carregar os detalhes do jogo.");
  const game = (await response.json() as any[])[0];
  if (!game) throw new Error("Jogo não encontrado.");
  const companies = game.involved_companies || [];
  const originalOverview = game.summary || game.storyline || "Sinopse indisponível.";
  const overview = await translatedOverview("igdb", String(game.id), originalOverview);
  const steamAppId=String((game.external_games||[]).find((entry:any)=>entry.external_game_source?.name==="Steam")?.uid||"");
  return { provider:"igdb", mediaType:"game", externalId:String(game.id), steamAppId, title:game.name, overview, posterUrl:imageUrl(game.cover?.url || game.artworks?.[0]?.url || game.screenshots?.[0]?.url), backdropUrl:imageUrl(game.artworks?.[0]?.url || game.screenshots?.[0]?.url || game.cover?.url, "1080p"), releaseYear:yearFromTimestamp(game.first_release_date), genres:(game.genres||[]).map((v:any)=>v.name), platforms:(game.platforms||[]).map((v:any)=>v.name), modes:(game.game_modes||[]).map((v:any)=>v.name), developers:companies.filter((v:any)=>v.developer).map((v:any)=>v.company?.name).filter(Boolean), publishers:companies.filter((v:any)=>v.publisher).map((v:any)=>v.company?.name).filter(Boolean), communityScore:game.total_rating ? Number((game.total_rating/10).toFixed(1)) : null, communityVotes:game.total_rating_count || 0 };
}

async function detailsTmdb(id: string, type: "movie" | "tv") {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) throw new Error("O catálogo de filmes não está configurado.");
  const url = new URL(`https://api.themoviedb.org/3/${type}/${Number(id)}`);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("append_to_response", "credits,videos");
  const response = await fetch(url, { headers: { Authorization:`Bearer ${token}`, accept:"application/json" } });
  if (!response.ok) throw new Error("Não foi possível carregar os detalhes da obra.");
  const item:any = await response.json();
  const directors = type === "movie" ? (item.credits?.crew||[]).filter((v:any)=>v.job==="Director").map((v:any)=>v.name) : (item.created_by||[]).map((v:any)=>v.name);
  const contentCategory=type==="tv" && (item.genres||[]).some((v:any)=>v.id===16) && (item.origin_country||[]).includes("JP") ? "anime" : type;
  let sourceStatus="";
  if(contentCategory==="anime")try{const query=`query ($search: String) { Media(search: $search, type: ANIME) { relations { edges { relationType node { type status } } } } }`;const anime=await fetch("https://graphql.anilist.co",{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({query,variables:{search:item.original_name||item.name}}),signal:AbortSignal.timeout(7000)}).then(result=>result.json()) as any;sourceStatus=anime?.data?.Media?.relations?.edges?.find((edge:any)=>edge.relationType==="ADAPTATION"&&edge.node?.type==="MANGA")?.node?.status||""}catch{}
  return { provider:"tmdb", mediaType:type, contentCategory, externalId:String(item.id), title:item.title||item.name, originalTitle:item.original_title||item.original_name, overview:item.overview||"Sinopse indisponível.", posterUrl:item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:"", backdropUrl:item.backdrop_path?`https://image.tmdb.org/t/p/w1280${item.backdrop_path}`:"", releaseYear:(item.release_date||item.first_air_date||"").slice(0,4), genres:(item.genres||[]).map((v:any)=>v.name), runtime:type==="movie"?item.runtime:(item.episode_run_time||[])[0], seasons:item.number_of_seasons, episodes:item.number_of_episodes, directors, cast:(item.credits?.cast||[]).slice(0,8).map((v:any)=>v.name), communityScore:item.vote_average?Number(item.vote_average.toFixed(1)):null, communityVotes:item.vote_count||0, status:item.status, sourceStatus, nextEpisodeDate:item.next_episode_to_air?.air_date||"", lastAirDate:item.last_air_date||"" };
}

function workSituation(details: any): string {
  if (details?.mediaType !== "tv") return "";
  if (details.contentCategory === "anime" && details.status === "Ended" && ["RELEASING", "HIATUS"].includes(details.sourceStatus)) {
    return details.sourceStatus === "HIATUS" ? "Em hiato · obra original ainda em publicação" : "Em andamento · obra original ainda em publicação";
  }
  if (details.status === "Returning Series") return details.nextEpisodeDate
    ? `Em andamento · próximo episódio em ${details.nextEpisodeDate}`
    : "Em andamento";
  const labels: Record<string,string> = { Ended:"Encerrada", Canceled:"Cancelada", Planned:"Planejada", Pilot:"Episódio piloto", "In Production":"Em produção" };
  return labels[details.status] || details.status || "Situação indisponível";
}

function comparableTitle(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function titleSimilarity(left: string, right: string) {
  const a = new Set(comparableTitle(left).split(" ").filter(Boolean));
  const b = new Set(comparableTitle(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const common = [...a].filter(word=>b.has(word)).length;
  return (2 * common) / (a.size + b.size);
}
async function cineMatch(_req: Request, externalId: string, title: string, originalTitle: string, year: string) {
  try {
    const cineDb = getJellyfinDb();
    if (!cineDb) return null;
    // O TMDB é compartilhado pelos dois catálogos e resolve com precisão as
    // diferenças entre títulos traduzidos e originais.
    let movie = cineDb.prepare(`SELECT b.Id AS id FROM BaseItems b
      JOIN BaseItemProviders p ON p.ItemId=b.Id
      WHERE p.ProviderId='Tmdb' AND p.ProviderValue=? AND b.Type LIKE '%.Movies.Movie' LIMIT 1`).get(externalId) as {id:string}|undefined;
    if (!movie) {
      const candidates = cineDb.prepare(`SELECT Id AS id,Name AS title,OriginalTitle AS originalTitle,ProductionYear AS year
        FROM BaseItems WHERE Type LIKE '%.Movies.Movie' AND IsFolder=0`).all() as {id:string,title:string,originalTitle:string,year:number|null}[];
      const names = [title, originalTitle].filter(Boolean);
      movie = candidates.find(item => {
        if (year && item.year && String(item.year)!==year) return false;
        const cineNames=[item.title,item.originalTitle].filter(Boolean);
        return names.some(name=>cineNames.some(cineName=>comparableTitle(name)===comparableTitle(cineName) || titleSimilarity(name,cineName)>=0.8));
      });
    }
    if (!movie) return null;
    const itemId=movie.id.replace(/-/g,"").toLowerCase();
    return { id:itemId, url:`https://cine.pugotilab.com/web/#/details?id=${itemId}&serverId=${encodeURIComponent(jellyfinServerId)}` };
  } catch { return null; }
}

async function fillMissingCreators(userId: string, items: any[]) {
  const missing = items.filter(item=>!item.creator_name);
  const gameIds = missing.filter(item=>item.provider==="igdb").map(item=>Number(item.external_id)).filter(Boolean);
  if (gameIds.length) {
    try {
      const token=await getIgdbToken(),clientId=process.env.IGDB_CLIENT_ID||"";
      const body=`fields involved_companies.company.name,involved_companies.developer; where id = (${gameIds.join(",")}); limit ${gameIds.length};`;
      const response=await fetch("https://api.igdb.com/v4/games",{method:"POST",headers:{"Client-ID":clientId,Authorization:`Bearer ${token}`,"content-type":"text/plain"},body});
      if(response.ok) for(const game of await response.json() as any[]){const name=(game.involved_companies||[]).find((entry:any)=>entry.developer)?.company?.name||"";if(name)db.prepare("UPDATE library_items SET creator_name=? WHERE user_id=? AND provider='igdb' AND external_id=?").run(name,userId,String(game.id))}
    } catch {}
  }
  const tmdbItems=missing.filter(item=>item.provider==="tmdb");
  await mapWithConcurrency(tmdbItems, 2, async item=>{
    try {const details=await detailsTmdb(item.external_id,item.media_type==="tv"?"tv":"movie");const name=details.directors?.[0]||"";if(name)db.prepare("UPDATE library_items SET creator_name=? WHERE id=? AND user_id=?").run(name,item.id,userId)} catch {}
  });
}

async function fillMissingSteamIds(userId:string,items:any[]){
  const missing=items.filter(item=>item.provider==="igdb"&&!item.steam_app_id).map(item=>Number(item.external_id)).filter(Boolean);
  if(!missing.length)return;
  try{const token=await getIgdbToken(),clientId=process.env.IGDB_CLIENT_ID||"";const body=`fields external_games.external_game_source.name,external_games.uid; where id=(${missing.join(",")}); limit ${missing.length};`;const response=await fetch("https://api.igdb.com/v4/games",{method:"POST",headers:{"Client-ID":clientId,Authorization:`Bearer ${token}`,"content-type":"text/plain"},body});if(!response.ok)return;for(const game of await response.json() as any[]){const appId=String((game.external_games||[]).find((entry:any)=>entry.external_game_source?.name==="Steam")?.uid||"");if(/^\d+$/.test(appId))db.prepare("UPDATE library_items SET steam_app_id=? WHERE user_id=? AND provider='igdb' AND external_id=?").run(appId,userId,String(game.id))}}catch{}
}

async function syncAchievementProgress(userId:string,items:any[]){
  if(!steamApiKey)return;
  const connection=db.prepare("SELECT steam_id_64 FROM user_steam_connections WHERE user_id=?").get(userId) as {steam_id_64:string}|undefined;
  if(!connection)return;
  const staleBefore=Date.now()-15*60_000;
  const games=items.filter(item=>item.media_type==="game"&&/^\d+$/.test(item.steam_app_id||"")&&(!item.achievements_synced_at||Date.parse(item.achievements_synced_at)<staleBefore));
  await mapWithConcurrency(games, 2, async item=>{
    try{
      const url=new URL("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/");
      for(const [key,value] of Object.entries({key:steamApiKey,steamid:connection.steam_id_64,appid:item.steam_app_id,l:"brazilian"}))url.searchParams.set(key,value);
      const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)return;
      const body=await response.json() as any;
      if(body?.playerstats?.success===false)return;
      const achievements=body?.playerstats?.achievements||[];
      const unlocked=achievements.filter((achievement:any)=>achievement.achieved).length;
      db.prepare("UPDATE library_items SET achievement_total=?,achievement_unlocked=?,achievements_synced_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(achievements.length,unlocked,item.id,userId);
    }catch{}
  });
}

async function refreshUserData(userId:string){
  await syncTasksOnce(userId).catch(()=>0);
  let items = db.prepare("SELECT * FROM library_items WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
  await Promise.all([fillMissingCreators(userId,items),fillMissingSteamIds(userId,items)]);
  items = db.prepare("SELECT * FROM library_items WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
  await syncAchievementProgress(userId,items);
}

const refreshInFlight = new Map<string, Promise<void>>();
const refreshLastStarted = new Map<string, number>();
function scheduleRefreshUserData(userId:string) {
  const current = refreshInFlight.get(userId);
  if (current) return current;
  const lastStarted = refreshLastStarted.get(userId) || 0;
  if (Date.now() - lastStarted < 60_000) return;
  refreshLastStarted.set(userId, Date.now());
  const job = refreshUserData(userId).finally(() => refreshInFlight.delete(userId));
  refreshInFlight.set(userId, job);
  return job;
}

const tasksSyncInFlight = new Map<string, Promise<number>>();
function syncTasksOnce(userId:string) {
  const current = tasksSyncInFlight.get(userId);
  if (current) return current;
  const job = syncTasksCompletion(userId).finally(() => tasksSyncInFlight.delete(userId));
  tasksSyncInFlight.set(userId, job);
  return job;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Resumo do Pugoti Profile ("Listas no Pugotilist"): o auth consulta pela rede interna com o token próprio.
// Token pela variável de ambiente ou pelo arquivo data/pugotilab-resumo-token (sem recriar o contêiner).
const resumoToken = process.env.PUGOTILAB_RESUMO_TOKEN || (() => { try { return fs.readFileSync(path.join(path.dirname(dbFile), "pugotilab-resumo-token"), "utf8").trim(); } catch { return ""; } })();
app.get("/api/pugotilab/listas/:userId", (req: any, res: any) => {
    const token = String(req.headers["x-pugotilab-resumo"] || "");
    if (!resumoToken || token.length !== resumoToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(resumoToken)))
        return res.status(401).json({ error: "Token inválido." });
    const listas = db.prepare(`SELECT l.id, l.name, l.description, COUNT(i.item_id) AS total,
        (SELECT li.poster_url FROM custom_list_items ci JOIN library_items li ON li.id = ci.item_id WHERE ci.list_id = l.id AND li.poster_url <> '' ORDER BY ci.position, ci.added_at LIMIT 1) AS capa
      FROM custom_lists l LEFT JOIN custom_list_items i ON i.list_id = l.id
      WHERE l.user_id = ? GROUP BY l.id ORDER BY l.created_at DESC LIMIT 8`).all(String(req.params.userId));
    const andamento = db.prepare(`SELECT title, poster_url, media_type FROM library_items WHERE user_id = ? AND status = 'in_progress'
      ORDER BY updated_at DESC LIMIT 8`).all(String(req.params.userId));
    const tipo: Record<string, string> = { movie: "Filme", tv: "Série", game: "Jogo" };
    res.json({
        lists: (listas as any[]).map((l) => ({ title: l.name, detail: `${l.total} ${l.total === 1 ? "item" : "itens"}`, imageUrl: l.capa || "", url: "https://list.pugotilab.com/" })),
        inProgress: (andamento as any[]).map((i) => ({ title: i.title, detail: `${tipo[i.media_type] || ""} em andamento`.trim(), imageUrl: i.poster_url || "", url: "https://list.pugotilab.com/" }))
    });
});
app.get("/api/bootstrap", requireUser, async (req: AuthedRequest, res) => {
  db.prepare("UPDATE library_items SET status='completed' WHERE user_id=? AND status<>'completed' AND (rating>0 OR TRIM(notes)<>'')").run(req.userId);
  const items = db.prepare("SELECT * FROM library_items WHERE user_id = ? ORDER BY updated_at DESC").all(req.userId) as any[];
  const lists = db.prepare(`SELECT l.id,l.name,l.description,l.icon,l.color,l.category,l.created_at createdAt,COUNT(li.item_id) itemCount
    FROM custom_lists l LEFT JOIN custom_list_items li ON li.list_id=l.id WHERE l.user_id=? GROUP BY l.id ORDER BY l.id`).all(req.userId);
  const steam=db.prepare("SELECT steam_id_64,connected_at,last_synced_at FROM user_steam_connections WHERE user_id=?").get(req.userId)||null;
  const xbox=db.prepare("SELECT xuid,gamertag,connected_at,last_synced_at FROM user_xbox_connections WHERE user_id=?").get(req.userId)||null;
  res.json({ profile: req.profile, items, lists, steam:{ configured:Boolean(steamApiKey), connected:Boolean(steam), connection:steam }, xbox:{ configured:Boolean(xboxClientId&&xboxClientSecret&&xboxTokenEncryptionKey), connected:Boolean(xbox), connection:xbox }, providers: { games: Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET), movies: Boolean(process.env.TMDB_READ_TOKEN) } });
  void scheduleRefreshUserData(req.userId!)?.catch(()=>{});
});
app.post("/api/sync/tasks",requireUser,async(req:AuthedRequest,res)=>{try{const changed=await syncTasksOnce(req.userId!);const items=db.prepare("SELECT * FROM library_items WHERE user_id=? ORDER BY updated_at DESC").all(req.userId);res.json({changed,items})}catch(error){res.status(502).json({error:error instanceof Error?error.message:"Falha ao sincronizar o Pugotitasks."})}});
app.get("/api/search", requireUser, async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 100);
  const type = String(req.query.type || "game");
  if (query.length < 2) return res.status(400).json({ error: "Digite ao menos dois caracteres." });
  try {
    const catalogType = type === "anime" ? "tv" : type;
    const catalogResults = catalogType === "game" ? await searchIgdb(query) : await searchTmdb(query, catalogType === "tv" ? "tv" : "movie");
    const results = type === "anime" ? catalogResults.filter((item:any)=>item.contentCategory==="anime") : catalogResults;
    res.json({ results, configured: type === "game" ? Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET) : Boolean(process.env.TMDB_READ_TOKEN) });
  } catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : "Falha no catálogo." }); }
});
app.get("/api/recommendations", requireUser, async (req: AuthedRequest, res) => {
  // Uma nota indica que a obra foi consumida. Cada categoria forma sua própria
  // base e nunca influencia as recomendações das demais.
  const rated = db.prepare(`SELECT provider,media_type,COALESCE(NULLIF(content_category,''),media_type) content_category,external_id,title,rating
    FROM library_items WHERE user_id=? AND rating>0 ORDER BY rating DESC,updated_at DESC`).all(req.userId) as any[];
  const seeds = (category:string) => rated.filter(item=>(item.media_type==="game"?"game":item.content_category)===category).slice(0,6);
  const gameSeeds=seeds("game"),movieSeeds=seeds("movie"),seriesSeeds=seeds("tv"),animeSeeds=seeds("anime");
  if (!rated.length) return res.json({ games:[], movies:[], series:[], anime:[], basedOn:{} });
  try {
    const [games,movies,series,anime] = await Promise.all([
      recommendIgdb(gameSeeds.map(item=>item.external_id)),
      recommendTmdb(movieSeeds,"movie"),recommendTmdb(seriesSeeds,"tv"),recommendTmdb(animeSeeds,"anime")
    ]);
    const owned = new Set((db.prepare("SELECT provider,external_id FROM library_items WHERE user_id=?").all(req.userId) as any[]).map(item=>`${item.provider}:${item.external_id}`));
    const unique=(items:any[])=>{const map=new Map<string,any>();for(const item of items.sort((a,b)=>(b.score||0)-(a.score||0))){const key=`${item.provider}:${item.externalId}`;if(!owned.has(key)&&item.posterUrl&&!map.has(key))map.set(key,item)}return [...map.values()].slice(0,18)};
    res.json({games:unique(games),movies:unique(movies),series:unique(series),anime:unique(anime),basedOn:{games:gameSeeds.slice(0,3).map(x=>x.title),movies:movieSeeds.slice(0,3).map(x=>x.title),series:seriesSeeds.slice(0,3).map(x=>x.title),anime:animeSeeds.slice(0,3).map(x=>x.title)}});
  } catch { res.json({games:[],movies:[],series:[],anime:[],basedOn:{}}); }
});
app.get("/api/details", requireUser, async (req: AuthedRequest, res) => {
  const provider = String(req.query.provider || "");
  const mediaType = String(req.query.type || "");
  const id = String(req.query.id || "");
  if (!/^\d+$/.test(id)) return res.status(400).json({ error:"Título inválido." });
  try {
    const details = provider === "igdb" ? await detailsIgdb(id) : await detailsTmdb(id, mediaType === "tv" ? "tv" : "movie");
    const creatorName = provider === "igdb" ? (details as any).developers?.[0] : (details as any).directors?.[0];
    if (creatorName) db.prepare("UPDATE library_items SET creator_name=? WHERE user_id=? AND provider=? AND media_type=? AND external_id=?").run(creatorName, req.userId, provider, mediaType, id);
    if(provider==="igdb"&&(details as any).steamAppId)db.prepare("UPDATE library_items SET steam_app_id=? WHERE user_id=? AND provider='igdb' AND external_id=?").run((details as any).steamAppId,req.userId,id);
    if(provider==="tmdb"&&mediaType==="tv")db.prepare("UPDATE library_items SET work_situation=? WHERE user_id=? AND provider='tmdb' AND media_type='tv' AND external_id=?").run(workSituation(details),req.userId,id);
    const personal = db.prepare("SELECT id,status,rating,favorite,notes,play_platform,steam_app_id,work_situation FROM library_items WHERE user_id=? AND provider=? AND media_type=? AND external_id=?").get(req.userId, provider, mediaType, id) || null;
    const cine = provider === "tmdb" && mediaType === "movie" ? await cineMatch(req, id, details.title, (details as any).originalTitle||"", details.releaseYear||"") : null;
    res.json({ details, personal, cine });
  } catch (error) { res.status(502).json({ error:error instanceof Error?error.message:"Falha ao carregar detalhes." }); }
});
app.post("/api/library", requireUser, async (req: AuthedRequest, res) => {
  const { provider, mediaType, contentCategory = "", externalId, title, posterUrl = "", releaseYear = "", creatorName = "", status = "planned" } = req.body || {};
  if (!provider || !mediaType || !externalId || !title) return res.status(400).json({ error: "Título inválido." });
  db.prepare(`INSERT INTO library_items (user_id,provider,media_type,external_id,title,poster_url,release_year,status)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider,media_type,external_id) DO UPDATE SET title=excluded.title,poster_url=excluded.poster_url,release_year=excluded.release_year,status=excluded.status,updated_at=CURRENT_TIMESTAMP`)
    .run(req.userId, provider, mediaType, String(externalId), String(title).slice(0, 240), String(posterUrl).slice(0, 1000), String(releaseYear).slice(0, 4), status);
  db.prepare("UPDATE library_items SET content_category=? WHERE user_id=? AND provider=? AND media_type=? AND external_id=?").run(String(contentCategory||mediaType).slice(0,16),req.userId,provider,mediaType,String(externalId));
  if (creatorName) db.prepare("UPDATE library_items SET creator_name=? WHERE user_id=? AND provider=? AND media_type=? AND external_id=?").run(String(creatorName).slice(0,160),req.userId,provider,mediaType,String(externalId));
  if(provider==="tmdb"&&mediaType==="tv"){
    try {
      const details=await detailsTmdb(String(externalId),"tv");
      db.prepare("UPDATE library_items SET content_category=?,creator_name=?,work_situation=? WHERE user_id=? AND provider='tmdb' AND media_type='tv' AND external_id=?")
        .run(details.contentCategory,String(details.directors?.[0]||creatorName||"").slice(0,160),workSituation(details),req.userId,String(externalId));
    } catch {}
  }
  const item = db.prepare("SELECT * FROM library_items WHERE user_id=? AND provider=? AND media_type=? AND external_id=?").get(req.userId, provider, mediaType, String(externalId));
  res.status(201).json({ item });
});
app.patch("/api/library/:id", requireUser, async (req: AuthedRequest, res) => {
  const current = db.prepare("SELECT * FROM library_items WHERE id=? AND user_id=?").get(req.params.id, req.userId) as any;
  if (!current) return res.status(404).json({ error: "Item não encontrado." });
  const status = req.body.status ?? ((Number(req.body.rating ?? current.rating)>0||String(req.body.notes??current.notes).trim())?"completed":current.status);
  const rating = Math.max(0, Math.min(10, Number(req.body.rating ?? current.rating)));
  const favorite = req.body.favorite == null ? current.favorite : (req.body.favorite ? 1 : 0);
  const notes = String(req.body.notes ?? current.notes).slice(0, 4000);
  const allowedPlatforms = ["", "steam", "playstation", "xbox", "nintendo"];
  const playPlatform = allowedPlatforms.includes(String(req.body.playPlatform ?? current.play_platform)) ? String(req.body.playPlatform ?? current.play_platform) : current.play_platform;
  db.prepare("UPDATE library_items SET status=?,rating=?,favorite=?,notes=?,play_platform=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(status, rating, favorite, notes, playPlatform, req.params.id, req.userId);
  if(status!==current.status){const tasks=db.prepare("SELECT DISTINCT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND l.user_id=? AND li.task_id<>''").all(req.params.id,req.userId) as any[];await Promise.all(tasks.map(link=>tasksApi(`/tasks/${link.task_id}`,{method:"PATCH",body:JSON.stringify({completed:status==="completed"})}).catch(()=>null)))}
  res.json({ item: db.prepare("SELECT * FROM library_items WHERE id=?").get(req.params.id) });
});
app.delete("/api/library/:id", requireUser, async (req: AuthedRequest, res) => {
  const linkedTasks=db.prepare("SELECT DISTINCT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND l.user_id=? AND li.task_id<>''").all(req.params.id,req.userId) as any[];
  const result=db.prepare("DELETE FROM library_items WHERE id=? AND user_id=?").run(req.params.id, req.userId);
  if(!result.changes)return res.status(404).json({error:"Item não encontrado."});
  await Promise.all(linkedTasks.map(link=>tasksApi(`/tasks/${link.task_id}`,{method:"DELETE"}).catch(()=>null)));
  res.status(204).end();
});
app.post("/api/lists", requireUser, (req: AuthedRequest, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Dê um nome à lista." });
  const icons=new Set(["playlist_play","movie","sports_esports","live_tv","animation","bookmark","star"]),colors=new Set(["#22c55e","#ef4444","#3b82f6","#f59e0b","#a855f7","#ec4899","#14b8a6","#64748b"]),categories=new Set(["mixed","game","movie","tv","anime"]);
  const icon=icons.has(req.body?.icon)?req.body.icon:"playlist_play",color=colors.has(req.body?.color)?req.body.color:"#3b82f6",category=categories.has(req.body?.category)?req.body.category:"mixed";
  try { const result = db.prepare("INSERT INTO custom_lists(user_id,name,description,icon,color,category) VALUES(?,?,?,?,?,?)").run(req.userId, name, String(req.body?.description || "").slice(0, 300),icon,color,category); res.status(201).json({ list:{id:Number(result.lastInsertRowid),name,description:String(req.body?.description||""),icon,color,category,itemCount:0} }); }
  catch { res.status(409).json({ error: "Você já possui uma lista com esse nome." }); }
});
app.get("/api/lists/:id",requireUser,(req:AuthedRequest,res)=>{
  const list=db.prepare("SELECT * FROM custom_lists WHERE id=? AND user_id=?").get(req.params.id,req.userId) as any;if(!list)return res.status(404).json({error:"Lista não encontrada."});
  const items=db.prepare(`SELECT i.*,li.position,li.task_id FROM custom_list_items li JOIN library_items i ON i.id=li.item_id WHERE li.list_id=? ORDER BY li.position,li.added_at`).all(req.params.id);
  res.json({list,items});
});
app.patch("/api/lists/:id",requireUser,(req:AuthedRequest,res)=>{const current=db.prepare("SELECT * FROM custom_lists WHERE id=? AND user_id=?").get(req.params.id,req.userId) as any;if(!current)return res.status(404).json({error:"Lista não encontrada."});const name=String(req.body.name??current.name).trim().slice(0,80);db.prepare("UPDATE custom_lists SET name=?,description=?,icon=?,color=?,category=? WHERE id=? AND user_id=?").run(name,String(req.body.description??current.description).slice(0,300),String(req.body.icon??current.icon),String(req.body.color??current.color),String(req.body.category??current.category),req.params.id,req.userId);res.json({list:db.prepare("SELECT * FROM custom_lists WHERE id=?").get(req.params.id)});});
app.delete("/api/lists/:id",requireUser,async(req:AuthedRequest,res)=>{
  const rows=db.prepare("SELECT li.item_id,li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE l.id=? AND l.user_id=?").all(req.params.id,req.userId) as any[];
  const removed=db.prepare("DELETE FROM custom_lists WHERE id=? AND user_id=?").run(req.params.id,req.userId);
  if(!removed.changes)return res.status(404).json({error:"Lista não encontrada."});
  const orphaned=rows.filter(row=>row.task_id&&!db.prepare("SELECT 1 FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND li.task_id=? AND l.user_id=?").get(row.item_id,row.task_id,req.userId));
  await Promise.all(orphaned.map(row=>tasksApi(`/tasks/${row.task_id}`,{method:"DELETE"}).catch(()=>null)));
  res.status(204).end();
});
app.post("/api/lists/:id/items/:itemId", requireUser, async (req: AuthedRequest, res) => {
  const list = db.prepare("SELECT id,category FROM custom_lists WHERE id=? AND user_id=?").get(req.params.id, req.userId) as any;
  const item = db.prepare("SELECT * FROM library_items WHERE id=? AND user_id=?").get(req.params.itemId, req.userId) as any;
  if (!list || !item) return res.status(404).json({ error: "Lista ou título não encontrado." });
  const category=item.media_type==="game"?"game":item.content_category||item.media_type;if(list.category!=="mixed"&&list.category!==category)return res.status(400).json({error:"Esta obra não pertence à categoria da lista."});
  const existing=db.prepare("SELECT 1 FROM custom_list_items WHERE list_id=? AND item_id=?").get(req.params.id,req.params.itemId);if(existing)return res.status(409).json({error:"Esta obra já está na lista."});
  const position=(db.prepare("SELECT COALESCE(MAX(position),-1)+1 value FROM custom_list_items WHERE list_id=?").get(req.params.id) as any).value;
  const linked=db.prepare("SELECT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND l.user_id=? AND li.task_id<>'' LIMIT 1").get(req.params.itemId,req.userId) as any;
  let taskId=String(linked?.task_id||"");if(!taskId)try{taskId=await createTasksLink(item)}catch(error){return res.status(502).json({error:error instanceof Error?error.message:"Falha no Pugotitasks."})}
  db.prepare("INSERT INTO custom_list_items(list_id,item_id,position,task_id) VALUES(?,?,?,?)").run(req.params.id,req.params.itemId,position,taskId);res.status(201).json({taskId});
});
app.delete("/api/lists/:id/items/:itemId",requireUser,async(req:AuthedRequest,res)=>{const row=db.prepare("SELECT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.list_id=? AND li.item_id=? AND l.user_id=?").get(req.params.id,req.params.itemId,req.userId) as any;if(!row)return res.status(404).json({error:"Item não encontrado."});db.prepare("DELETE FROM custom_list_items WHERE list_id=? AND item_id=?").run(req.params.id,req.params.itemId);const stillLinked=row.task_id&&db.prepare("SELECT 1 FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND li.task_id=? AND l.user_id=?").get(req.params.itemId,row.task_id,req.userId);if(row.task_id&&!stillLinked)await tasksApi(`/tasks/${row.task_id}`,{method:"DELETE"}).catch(()=>null);res.status(204).end();});
app.post("/api/lists/:id/reorder",requireUser,async(req:AuthedRequest,res)=>{const list=db.prepare("SELECT id FROM custom_lists WHERE id=? AND user_id=?").get(req.params.id,req.userId);if(!list)return res.status(404).json({error:"Lista não encontrada."});const ids=(Array.isArray(req.body.itemIds)?req.body.itemIds:[]).map(Number);const update=db.prepare("UPDATE custom_list_items SET position=? WHERE list_id=? AND item_id=?");db.transaction(()=>ids.forEach((id:number,index:number)=>update.run(index,req.params.id,id)))();const tasks=db.prepare("SELECT task_id FROM custom_list_items WHERE list_id=? ORDER BY position").all(req.params.id) as any[];await tasksApi("/tasks/reorder",{method:"POST",body:JSON.stringify({orderedIds:tasks.map(x=>x.task_id).filter(Boolean)})}).catch(()=>null);res.status(204).end();});
app.patch("/api/lists/:id/items/:itemId/complete",requireUser,async(req:AuthedRequest,res)=>{const row=db.prepare("SELECT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.list_id=? AND li.item_id=? AND l.user_id=?").get(req.params.id,req.params.itemId,req.userId) as any;if(!row)return res.status(404).json({error:"Item não encontrado."});const completed=Boolean(req.body.completed);db.prepare("UPDATE library_items SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(completed?"completed":"planned",req.params.itemId,req.userId);const linkedTasks=db.prepare("SELECT DISTINCT li.task_id FROM custom_list_items li JOIN custom_lists l ON l.id=li.list_id WHERE li.item_id=? AND l.user_id=? AND li.task_id<>''").all(req.params.itemId,req.userId) as any[];await Promise.all(linkedTasks.map(link=>tasksApi(`/tasks/${link.task_id}`,{method:"PATCH",body:JSON.stringify({completed})})));res.json({completed});});
app.get("/api/integrations/steam/connect", requireUser, (req:AuthedRequest,res)=>{
  const requestedBase=String(req.query.base||publicOrigin).replace(/\/$/,"");
  const returnBase=/^https:\/\/(?:[a-z0-9-]+\.)?pugotilab\.com(?:\/list)?$/i.test(requestedBase)?requestedBase:publicOrigin;
  const state=crypto.randomBytes(24).toString("hex"),callback=`${returnBase}/api/integrations/steam/callback?state=${state}`;
  db.prepare("DELETE FROM steam_openid_states WHERE expires_at<?").run(Date.now());
  db.prepare("INSERT INTO steam_openid_states(state,user_id,expires_at,return_base) VALUES(?,?,?,?)").run(state,req.userId,Date.now()+10*60_000,returnBase);
  const url=new URL("https://steamcommunity.com/openid/login");
  for(const [key,value] of Object.entries({"openid.ns":"http://specs.openid.net/auth/2.0","openid.mode":"checkid_setup","openid.return_to":callback,"openid.realm":returnBase,"openid.identity":"http://specs.openid.net/auth/2.0/identifier_select","openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select"}))url.searchParams.set(key,value);
  res.redirect(url.toString());
});
app.get("/api/integrations/steam/callback",requireUser,async(req:AuthedRequest,res)=>{
  const state=String(req.query.state||""),saved=db.prepare("SELECT user_id,expires_at,return_base FROM steam_openid_states WHERE state=?").get(state) as {user_id:string;expires_at:number;return_base:string}|undefined;
  db.prepare("DELETE FROM steam_openid_states WHERE state=?").run(state);
  if(!saved||saved.user_id!==req.userId||saved.expires_at<Date.now())return res.status(400).send("Conexão Steam expirada. Volte ao Pugotilist e tente novamente.");
  const params=new URLSearchParams();for(const [key,value] of Object.entries(req.query))if(key.startsWith("openid.")&&typeof value==="string")params.set(key,value);params.set("openid.mode","check_authentication");
  try{const validation=await fetch("https://steamcommunity.com/openid/login",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:params});const result=await validation.text();if(!result.includes("is_valid:true"))throw new Error("invalid");const claimed=String(req.query["openid.claimed_id"]||"");const match=claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);if(!match)throw new Error("identity");db.prepare(`INSERT INTO user_steam_connections(user_id,steam_id_64) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET steam_id_64=excluded.steam_id_64,connected_at=CURRENT_TIMESTAMP`).run(req.userId,match[1]);res.redirect(`${saved.return_base||publicOrigin}/?steam=connected`)}catch{res.status(502).send("Não foi possível validar o login com a Steam.")}
});
app.delete("/api/integrations/steam",requireUser,(req:AuthedRequest,res)=>{db.prepare("DELETE FROM user_steam_connections WHERE user_id=?").run(req.userId);res.status(204).end()});
app.get("/api/integrations/xbox/connect",requireUser,(req:AuthedRequest,res)=>{
  if(!xboxClientId||!xboxClientSecret||!xboxTokenEncryptionKey)return res.status(503).send("A integração Xbox ainda não foi configurada no servidor.");
  const requestedBase=String(req.query.base||publicOrigin).replace(/\/$/,"");
  const returnBase=/^https:\/\/(?:[a-z0-9-]+\.)?pugotilab\.com(?:\/list)?$/i.test(requestedBase)?requestedBase:publicOrigin;
  const state=crypto.randomBytes(24).toString("hex");
  db.prepare("DELETE FROM xbox_oauth_states WHERE expires_at<?").run(Date.now());
  db.prepare("INSERT INTO xbox_oauth_states(state,user_id,expires_at,return_base) VALUES(?,?,?,?)").run(state,req.userId,Date.now()+10*60_000,returnBase);
  const url=new URL("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize");
  for(const [key,value] of Object.entries({client_id:xboxClientId,response_type:"code",redirect_uri:xboxRedirectUri,scope:"xboxlive.signin xboxlive.offline_access",state}))url.searchParams.set(key,value);
  res.redirect(url.toString());
});
app.get("/api/integrations/xbox/callback",requireUser,async(req:AuthedRequest,res)=>{
  const state=String(req.query.state||""),saved=db.prepare("SELECT user_id,expires_at,return_base FROM xbox_oauth_states WHERE state=?").get(state) as {user_id:string;expires_at:number;return_base:string}|undefined;
  db.prepare("DELETE FROM xbox_oauth_states WHERE state=?").run(state);
  if(!saved||saved.user_id!==req.userId||saved.expires_at<Date.now())return res.status(400).send("Conexão Xbox expirada. Volte ao Pugotilist e tente novamente.");
  try{
    const code=String(req.query.code||"");if(!code)throw new Error("Código ausente.");
    const token=await xboxMicrosoftToken(new URLSearchParams({client_id:xboxClientId,client_secret:xboxClientSecret,code,redirect_uri:xboxRedirectUri,grant_type:"authorization_code"}));
    if(!token.refresh_token)throw new Error("A Microsoft não retornou refresh token.");
    const session=await xboxSessionFromAccessToken(token.access_token),profile=await xboxProfile(session);
    db.prepare(`INSERT INTO user_xbox_connections(user_id,xuid,gamertag,refresh_token) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET xuid=excluded.xuid,gamertag=excluded.gamertag,refresh_token=excluded.refresh_token,connected_at=CURRENT_TIMESTAMP`).run(req.userId,profile.xuid,profile.gamertag,encryptXboxToken(token.refresh_token));
    res.redirect(`${saved.return_base||publicOrigin}/?xbox=connected`);
  }catch(error){res.status(502).send(error instanceof Error?error.message:"Não foi possível conectar a conta Xbox.")}
});
app.delete("/api/integrations/xbox",requireUser,(req:AuthedRequest,res)=>{db.prepare("DELETE FROM user_xbox_connections WHERE user_id=?").run(req.userId);res.status(204).end()});
app.get("/api/integrations/xbox/profile",requireUser,async(req:AuthedRequest,res)=>{
  if(!xboxClientId||!xboxClientSecret||!xboxTokenEncryptionKey)return res.status(503).json({error:"A integração Xbox ainda não foi configurada no servidor."});
  const connection=db.prepare("SELECT * FROM user_xbox_connections WHERE user_id=?").get(req.userId) as {xuid:string;gamertag:string;refresh_token:string}|undefined;
  if(!connection)return res.status(404).json({error:"Nenhuma conta Xbox conectada."});
  try{const token=await xboxMicrosoftToken(new URLSearchParams({client_id:xboxClientId,client_secret:xboxClientSecret,refresh_token:decryptXboxToken(connection.refresh_token),grant_type:"refresh_token",scope:"xboxlive.signin xboxlive.offline_access"}));const session=await xboxSessionFromAccessToken(token.access_token),profile=await xboxProfile(session);if(token.refresh_token)db.prepare("UPDATE user_xbox_connections SET refresh_token=?,xuid=?,gamertag=?,last_synced_at=CURRENT_TIMESTAMP WHERE user_id=?").run(encryptXboxToken(token.refresh_token),profile.xuid,profile.gamertag,req.userId);res.json({connected:true,...profile})}catch{res.status(502).json({error:"Não foi possível atualizar o perfil Xbox."})}
});
app.get("/api/games/:id/achievements",requireUser,async(req:AuthedRequest,res)=>{
  if(!steamApiKey)return res.status(503).json({error:"A chave da Steam ainda não foi configurada no servidor."});
  const item=db.prepare("SELECT steam_app_id FROM library_items WHERE id=? AND user_id=? AND media_type='game'").get(req.params.id,req.userId) as {steam_app_id:string}|undefined;
  if(!item?.steam_app_id)return res.status(404).json({error:"Este jogo ainda não foi associado à versão da Steam."});
  const connection=db.prepare("SELECT steam_id_64 FROM user_steam_connections WHERE user_id=?").get(req.userId) as {steam_id_64:string}|undefined;
  const call=async(path:string,params:Record<string,string>)=>{const url=new URL(`https://api.steampowered.com/${path}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(String(response.status));return response.json() as Promise<any>};
  try{const appid=item.steam_app_id;const [schema,global,player]=await Promise.all([call("ISteamUserStats/GetSchemaForGame/v2/",{key:steamApiKey,appid,l:"brazilian"}),call("ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",{gameid:appid}),connection?call("ISteamUserStats/GetPlayerAchievements/v1/",{key:steamApiKey,steamid:connection.steam_id_64,appid,l:"brazilian"}).catch(()=>null):null]);const personal=new Map((player?.playerstats?.achievements||[]).map((a:any)=>[a.apiname,a]));const rarity=new Map((global?.achievementpercentages?.achievements||[]).map((a:any)=>[a.name,a.percent]));const achievements=(schema?.game?.availableGameStats?.achievements||[]).map((a:any)=>{const own:any=personal.get(a.name);return{id:a.name,name:a.displayName||a.name,description:a.description||"Conquista oculta",iconUrl:a.icon,lockedIconUrl:a.icongray,hidden:Boolean(a.hidden),globalCompletionPercent:Number(rarity.get(a.name)||0),unlocked:Boolean(own?.achieved),unlockedAt:own?.unlocktime?new Date(own.unlocktime*1000).toISOString():null}});const unlocked=achievements.filter((a:any)=>a.unlocked).length;res.json({steamAppId:appid,connected:Boolean(connection),gameName:schema?.game?.gameName||"",total:achievements.length,unlocked,completionPercent:achievements.length?Math.round(unlocked/achievements.length*100):0,achievements})}catch{res.status(502).json({error:"A Steam não respondeu com as conquistas deste jogo."})}
});
app.get("/api/games/:id/guides",requireUser,async(req:AuthedRequest,res)=>{
  if(!steamApiKey)return res.status(503).json({error:"A chave da Steam ainda não foi configurada no servidor."});
  const item=db.prepare("SELECT steam_app_id,title FROM library_items WHERE id=? AND user_id=? AND media_type='game'").get(req.params.id,req.userId) as {steam_app_id:string;title:string}|undefined;
  if(!item?.steam_app_id)return res.status(404).json({error:"Este jogo ainda não foi associado à versão da Steam."});
  const cached=steamGuideCache.get(item.steam_app_id);
  if(cached&&cached.expiresAt>Date.now())return res.json(cached.data);
  const searchTerms=["conquistas","100%","achievements","walkthrough","platinum"];
  const query=async(searchText:string)=>{
    const url=new URL("https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/");
    const params={key:steamApiKey,query_type:"1",page:"1",numperpage:"20",appid:item.steam_app_id,filetype:"10",return_short_description:"true",return_vote_data:"true",return_tags:"true",search_text:searchText};
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error(String(response.status));
    const body=await response.json() as any;
    return body?.response?.publishedfiledetails||[];
  };
  try{
    const batches=await Promise.all(searchTerms.map(term=>query(term)));
    const unique=new Map<string,any>();
    for(const guide of batches.flat())if(guide?.publishedfileid&&!guide.banned&&Number(guide.visibility)===0)unique.set(String(guide.publishedfileid),guide);
    const creators=[...new Set([...unique.values()].map(guide=>String(guide.creator||"")).filter(Boolean))].slice(0,100);
    const authorNames=new Map<string,string>();
    if(creators.length){
      const url=new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
      url.searchParams.set("key",steamApiKey);url.searchParams.set("steamids",creators.join(","));
      const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
      if(response.ok){const body=await response.json() as any;for(const player of body?.response?.players||[])authorNames.set(String(player.steamid),String(player.personaname||"Comunidade Steam"));}
    }
    const portuguese=/\b(guia|conquista|trof[eé]u|platina|detonado|completo|todos?|todas?|localiza[cç][aã]o|solu[cç][aã]o)\b/i;
    const achievement=/\b(achievement|achievements|conquista|conquistas|trof[eé]u|trof[eé]us|platina|platinum|100%)\b/i;
    const guides=[...unique.values()].map(guide=>{
      const title=String(guide.title||"Guia da Comunidade");
      const tags=(guide.tags||[]).map((tag:any)=>String(tag.display_name||tag.tag||"")).filter(Boolean);
      const votesUp=Number(guide.vote_data?.votes_up||0),votesDown=Number(guide.vote_data?.votes_down||0),voteScore=Number(guide.vote_data?.score||0),views=Number(guide.views||0);
      const isPortuguese=portuguese.test(title),isAchievementGuide=achievement.test(title)||tags.some((tag:string)=>/achievement/i.test(tag));
      const rank=(isPortuguese?80:0)+(isAchievementGuide?55:0)+voteScore*30+Math.log10(votesUp+1)*12+Math.log10(views+1)*6;
      return{id:String(guide.publishedfileid),title,description:String(guide.short_description||""),authorId:String(guide.creator||""),author:authorNames.get(String(guide.creator||""))||"Comunidade Steam",previewUrl:String(guide.preview_url||guide.file_url||""),url:`https://steamcommunity.com/sharedfiles/filedetails/?id=${guide.publishedfileid}`,tags,votesUp,votesDown,voteScore,views,isPortuguese,isAchievementGuide,updatedAt:guide.time_updated?new Date(Number(guide.time_updated)*1000).toISOString():null,rank};
    }).sort((left,right)=>right.rank-left.rank).slice(0,24).map(({rank,...guide})=>guide);
    const data={steamAppId:item.steam_app_id,gameName:item.title,total:guides.length,guides};
    steamGuideCache.set(item.steam_app_id,{expiresAt:Date.now()+30*60_000,data});
    res.json(data);
  }catch{res.status(502).json({error:"A Steam não respondeu com os guias deste jogo."});}
});
app.get("/", (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(path.join(publicDir, "index.html")); });
app.use(express.static(publicDir, { extensions: ["html"], maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.use((_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.listen(port, () => console.log(`Pugotilist ativo na porta ${port}`));
