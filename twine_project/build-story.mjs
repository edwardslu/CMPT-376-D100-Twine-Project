import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const controlsPath = path.join(root, "story_controls.json");
const tweePath = path.join(root, "Twine_project.twee");
const htmlPath = path.join(root, "Twine_project.html");

const title = "Subscribe & Pay";
const ifid = "247B5902-16C6-4EF5-B45B-F2D6D963D17B";
const controls = JSON.parse(fs.readFileSync(controlsPath, "utf8"));
const previousTwee = fs.readFileSync(tweePath, "utf8").replace(/\r\n/g, "\n");
const htmlTemplate = fs.readFileSync(htmlPath, "utf8");

function parseSections(source) {
  const headerPattern = /^::\s+([^\[\{\n]+?)(?:\s+\[([^\]]*)\])?(?:\s+(\{[^\n]*\}))?\s*$/gm;
  const headers = [...source.matchAll(headerPattern)];
  return headers.map((match, index) => {
    const bodyStart = match.index + match[0].length + 1;
    const bodyEnd = index + 1 < headers.length ? headers[index + 1].index : source.length;
    return {
      name: match[1].trim(),
      body: source.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

const oldSections = parseSections(previousTwee);
const storyScript = oldSections.find((section) => section.name === "StoryScript")?.body;
const storyStylesheet = oldSections.find((section) => section.name === "StoryStylesheet")?.body;

if (!storyScript || !storyStylesheet) {
  throw new Error("StoryScript or StoryStylesheet is missing from the existing Twee source.");
}

const sceneMeta = {
  graduation: {
    alt: "A graduation cap and diploma.",
    creditUrl: "https://www.pexels.com/photo/photo-of-person-holding-graduation-cap-and-diploma-7944064/",
    creditLabel: "Pavel Danilyuk / Pexels",
  },
  office: {
    alt: "An empty modern office at Amaze.",
    creditUrl: "https://www.pexels.com/photo/an-empty-office-5483236/",
    creditLabel: "cottonbro studio / Pexels",
  },
  rain: {
    alt: "Rain on a window overlooking city buildings.",
    creditUrl: "https://www.pexels.com/photo/wet-window-2181075/",
    creditLabel: "Rodrigo Jubram / Pexels",
  },
  deliveries: {
    alt: "A delivery van filled with cardboard parcels.",
    creditUrl: "https://www.pexels.com/photo/brown-cardboard-boxes-inside-the-van-6169662/",
    creditLabel: "Tima Miroshnichenko / Pexels",
  },
};

function buildPassage(entry) {
  const scene = sceneMeta[entry.scene];
  if (!scene) throw new Error(`Unknown scene '${entry.scene}' in ${entry.name}.`);
  const typing = entry.tags.split(/\s+/).includes("typing");
  const cue = entry.cue || "";
  const credit = `<p class="photo-credit">Photo: <a href="${scene.creditUrl}" target="_blank" rel="noopener">${scene.creditLabel}</a></p>`;
  const shell = `<div class="passage-shell" data-scene="${entry.scene}" data-typing="${typing}" data-cue="${cue}"><div class="scene-hero" role="img" aria-label="${scene.alt}"></div>${credit}<div class="story-copy"><p class="kicker">${entry.chapter}</p><h1>${entry.title}</h1>${entry.body}<div class="choices">\n${entry.links}\n</div></div></div>`;
  return [entry.code, shell].filter(Boolean).join("\n");
}

const passageBodies = new Map(controls.map((entry) => [entry.name, buildPassage(entry)]));
const passageNames = new Set(passageBodies.keys());
const linkPattern = /\[\[(?:[^\]]*?->)?([^\]]+)\]\]/g;
const brokenLinks = [];

for (const [source, body] of passageBodies) {
  for (const match of body.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (!passageNames.has(target)) brokenLinks.push(`${source} -> ${target}`);
  }
}

if (brokenLinks.length) {
  throw new Error(`Broken passage links:\n${brokenLinks.join("\n")}`);
}

const storyData = {
  ifid,
  format: "Harlowe",
  "format-version": "3.3.9",
  start: "Start",
  zoom: 0.75,
};

const tweeParts = [
  `:: StoryTitle\n${title}`,
  `:: StoryData\n${JSON.stringify(storyData, null, 2)}`,
  ...controls.map((entry) => {
    const tags = entry.tags ? ` [${entry.tags}]` : "";
    const metadata = JSON.stringify({ position: entry.position, size: "100,100" });
    return `:: ${entry.name}${tags} ${metadata}\n${passageBodies.get(entry.name)}`;
  }),
  `:: StoryScript [script]\n${storyScript}`,
  `:: StoryStylesheet [stylesheet]\n${storyStylesheet}`,
];

fs.writeFileSync(tweePath, `${tweeParts.join("\n\n\n")}\n`);

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const passageMarkup = controls.map((entry, index) => {
  const tags = escapeHtml(entry.tags || "");
  return `<tw-passagedata pid="${index + 1}" name="${escapeHtml(entry.name)}" tags="${tags}" position="${escapeHtml(entry.position)}" size="100,100">${escapeHtml(passageBodies.get(entry.name))}</tw-passagedata>`;
}).join("");

const startNode = controls.findIndex((entry) => entry.name === "Start") + 1;
const safeStylesheet = storyStylesheet.replaceAll("</style", "<\\/style");
const safeScript = storyScript.replaceAll("</script", "<\\/script");
const storyMarkup = `<tw-storydata name="${escapeHtml(title)}" startnode="${startNode}" creator="Twine" creator-version="2.12.1" format="Harlowe" format-version="3.3.9" ifid="${ifid}" options="" tags="" zoom="0.75" hidden><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">${safeStylesheet}</style><script role="script" id="twine-user-script" type="text/twine-javascript">${safeScript}</script>${passageMarkup}</tw-storydata>`;

const storyDataPattern = /<tw-storydata[\s\S]*?<\/tw-storydata>/;
if (!storyDataPattern.test(htmlTemplate)) {
  throw new Error("The story data in the HTML template could not be found.");
}

let generatedHtml = htmlTemplate.replace(storyDataPattern, storyMarkup);
generatedHtml = generatedHtml.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);

fs.writeFileSync(htmlPath, generatedHtml);
console.log(`Built ${controls.length} passages with no broken links.`);
