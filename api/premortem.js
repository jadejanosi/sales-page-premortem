// ECLIPSE: Sales Page Premortem API (Vercel serverless function)
// Env var required: ANTHROPIC_API_KEY
import dns from "node:dns/promises";
import net from "node:net";
import { buildPrompt } from "./_prompt.js";

const MODEL = "claude-sonnet-5";
const MAX_CHARS = 60000;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("That URL isn't valid. Include https://"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https URLs are supported.");
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error("That address can't be analyzed.");
  return u.toString();
}

function decode(s) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToCopy(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  let body = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<h([1-4])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-4]>/gi, "\n")
    .replace(/<button[^>]*>([\s\S]*?)<\/button>/gi, " [BUTTON: $1] ")
    .replace(/<a[^>]*class="[^"]*(btn|button|cta)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, " [BUTTON: $2] ")
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, " [IMAGE: $1] ")
    .replace(/<(li)[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/section|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  body = decode(body).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return (title ? `PAGE TITLE: ${decode(title).trim()}\n\n` : "") + body;
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (ECLIPSE Sales Page Premortem)", Accept: "text/html" } });
    if (!r.ok) throw new Error(`The page returned an error (${r.status}). Check that it's public, or paste the copy instead.`);
    const type = r.headers.get("content-type") || "";
    if (!type.includes("html")) throw new Error("That URL isn't a web page. Paste the copy instead.");
    await assertPublicUrl(r.url); // re-check after redirects
    return htmlToCopy((await r.text()).slice(0, 2_000_000));
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    let text = (b.text || "").toString();
    let url = "";
    if (b.mode === "url") {
      url = await assertPublicUrl((b.url || "").toString().trim());
      text = await fetchPage(url);
    }
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 120) return res.status(400).json({ error: b.mode === "url" ? "ECLIPSE couldn't read enough copy from that page (it may load its text with JavaScript). Paste the copy instead." : "Paste at least 120 words of sales page copy." });

    const prompt = buildPrompt({
      text: text.slice(0, MAX_CHARS),
      url,
      price: (b.price || "").toString().slice(0, 40),
      traffic: ["cold", "warm", "mixed"].includes(b.traffic) ? b.traffic : "cold",
      adLine: (b.adLine || "").toString().slice(0, 300)
    });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: prompt }] })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || "The analysis service is unavailable. Try again in a minute.");
    const raw = data.content.filter(c => c.type === "text").map(c => c.text).join("");
    const clean = raw.replace(/```json|```/g, "").trim();
    const report = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
    return res.status(200).json({ report, words });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Something broke during the premortem. Try again." });
  }
}
