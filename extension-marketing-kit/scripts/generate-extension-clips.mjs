// Reusable base extracted from Deep Note.
// Update the config constants, sample notes, mock API responses, and clip scenarios for the new extension.

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const projectRoot = process.cwd();
const extensionPath = path.join(projectRoot, 'dist');
const outputDir = path.join(projectRoot, 'store-assets', 'video-clips');
const fallbackExtensionId = 'delpbohcpcfafanddoeclcldjjjmogge';
const apiOrigin = 'https://notetaker-backend.notetaker-app-burak.workers.dev';
const sampleImageDataUri = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="720" height="520" viewBox="0 0 720 520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="%230f766e"/><stop offset="100%" stop-color="%231e293b"/></linearGradient></defs><rect width="720" height="520" rx="36" fill="url(%23g)"/><rect x="48" y="48" width="624" height="424" rx="28" fill="rgba(255,255,255,0.08)"/><text x="78" y="126" fill="white" font-size="52" font-family="Segoe UI, Arial, sans-serif" font-weight="700">Swipe File</text><text x="78" y="182" fill="%23d1fae5" font-size="26" font-family="Segoe UI, Arial, sans-serif">Hooks, creative references, and campaign ideas</text><rect x="78" y="232" width="230" height="52" rx="26" fill="rgba(255,255,255,0.16)"/><text x="106" y="266" fill="white" font-size="22" font-family="Segoe UI, Arial, sans-serif">campaign inspo</text><rect x="326" y="232" width="180" height="52" rx="26" fill="rgba(255,255,255,0.16)"/><text x="356" y="266" fill="white" font-size="22" font-family="Segoe UI, Arial, sans-serif">UGC ad</text><rect x="78" y="318" width="548" height="88" rx="24" fill="rgba(255,255,255,0.12)"/><text x="104" y="368" fill="white" font-size="28" font-family="Segoe UI, Arial, sans-serif">Save the examples you want to steal later, respectfully.</text></svg>';

const sampleNotes = [
  {
    id: 'note-1',
    text: 'Great retention systems come from repeated value, fast capture, and a clear habit loop that brings users back without friction.',
    opinion: 'This feels like the core Deep Note story: save fast now, organize later, and come back with less mental overhead.',
    summary: 'Retention grows when capture is frictionless and the return path stays clear.',
    tags: ['product/growth', 'retention'],
    url: 'https://example.com/growth/retention-loops',
    title: 'Retention Loops and Fast Capture',
    createdAt: Date.now() - 1000 * 60 * 90,
    comments: [{ id: 'c-1', text: 'Strong framing for the landing page later.', createdAt: Date.now() - 1000 * 60 * 30 }],
    summaryTone: 'standard',
    summaryCache: { standard: 'Retention grows when capture is frictionless and the return path stays clear.' },
    summarySourceKey: 'Retention source',
    flagged: true,
  },
  {
    id: 'note-2',
    text: 'Researchers remember tools that preserve context. The best tools keep the source, the takeaway, and the next action connected.',
    opinion: '',
    summary: 'Context-rich notes are easier to trust and revisit later.',
    tags: ['research', 'product/ux'],
    url: 'https://example.com/research/context-tools',
    title: 'Why Context Matters in Research Tools',
    createdAt: Date.now() - 1000 * 60 * 60 * 8,
    summaryTone: 'formal',
    summaryCache: { formal: 'Context-rich notes are easier to trust and revisit later.' },
    summarySourceKey: 'Context source',
  },
  {
    id: 'note-3',
    text: 'A DOI gives you a stable academic reference and makes citation output much stronger when the source is a paper or journal page.',
    opinion: 'Useful for Deep Note because citation quality matters more once users are saving serious research.',
    summary: 'DOIs make academic sources easier to cite and verify.',
    tags: ['research/papers', 'citation'],
    url: 'https://doi.org/10.1145/1234567.8901234',
    doi: '10.1145/1234567.8901234',
    title: 'Persistent Identifiers in Scholarly Publishing',
    createdAt: Date.now() - 1000 * 60 * 60 * 28,
    summaryTone: 'standard',
    summaryCache: { standard: 'DOIs make academic sources easier to cite and verify.' },
    summarySourceKey: 'DOI source',
  },
  {
    id: 'note-4',
    text: 'The best landing pages make the promise fast, prove it with one concrete behavior, and remove the extra paragraphs that slow first understanding.',
    opinion: 'Good reminder for store assets too: one message per screenshot.',
    summary: 'Clear landing pages win by making the product promise obvious in seconds.',
    tags: ['marketing/examples', 'good-to-know'],
    url: 'https://example.com/marketing/landing-pages',
    title: 'How Great Landing Pages Convert Faster',
    createdAt: Date.now() - 1000 * 60 * 150,
    summaryTone: 'standard',
    summaryCache: { standard: 'Clear landing pages win by making the product promise obvious in seconds.' },
    summarySourceKey: 'Landing source',
  },
  {
    id: 'note-5',
    text: 'Developers stick with tools that feel fast, local, and low-friction. If a thought takes too many clicks to save, it usually gets lost forever.',
    opinion: '',
    summary: 'Developer tools keep momentum when saving useful context feels instant.',
    tags: ['development', 'product/ux'],
    url: 'https://example.com/development/devtools-momentum',
    title: 'Low-Friction Tools Win Developer Attention',
    createdAt: Date.now() - 1000 * 60 * 60 * 4,
    summaryTone: 'standard',
    summaryCache: { standard: 'Developer tools keep momentum when saving useful context feels instant.' },
    summarySourceKey: 'Dev source',
  },
  {
    id: 'note-6',
    text: 'If the product nails capture and recall, that is the whole game type shit.',
    opinion: 'This is the playful version of the same idea, but it lands way faster for internet-native users.',
    summary: 'Lowkey this dude thinks capture speed is the whole religion rn, and honestly... 67% right, type shit.',
    tags: ['good-to-know', 'marketing/hooks'],
    url: 'https://example.com/product/future-you',
    title: 'Why Fast Capture Actually Matters',
    createdAt: Date.now() - 1000 * 60 * 45,
    summaryTone: 'type-shit',
    summaryCache: { 'type-shit': 'Lowkey this dude thinks capture speed is the whole religion rn, and honestly... 67% right, type shit.' },
    summarySourceKey: 'Type shit source',
  },
  {
    id: 'note-7',
    text: '',
    opinion: 'Save visual references too. This turns Deep Note into a real swipe file instead of just text storage.',
    summary: 'Image references make campaign research way more reusable later.',
    tags: ['marketing/references', 'references'],
    url: 'https://example.com/marketing/ugc-creative',
    title: 'UGC Creative Reference Board',
    imageUrl: sampleImageDataUri,
    createdAt: Date.now() - 1000 * 60 * 20,
    summaryTone: 'standard',
    summaryCache: { standard: 'Image references make campaign research way more reusable later.' },
    summarySourceKey: 'Image source',
  },
  {
    id: 'note-8',
    text: 'Good marketing notes are not random bookmarks. They become a system: hooks, references, examples, ideas, proof, and things to test later.',
    opinion: '',
    summary: 'A useful swipe file feels organized enough to become a real working system.',
    tags: ['marketing/campaigns', 'ideas'],
    url: 'https://example.com/marketing/swipe-file-system',
    title: 'Turn Saved Examples into a Real Swipe File',
    createdAt: Date.now() - 1000 * 60 * 200,
    summaryTone: 'standard',
    summaryCache: { standard: 'A useful swipe file feels organized enough to become a real working system.' },
    summarySourceKey: 'Swipe source',
  },
];

const articleHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deep Note Sample Article</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #f8fafc 0%, #eef6f7 100%);
        color: #0f172a;
      }
      .wrap {
        max-width: 860px;
        margin: 0 auto;
        padding: 56px 24px 120px;
      }
      .eyebrow {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: #dff6f2;
        color: #0f766e;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 12px;
      }
      h1 {
        font-size: 46px;
        line-height: 1.05;
        margin: 18px 0 14px;
      }
      .lede {
        font-size: 20px;
        line-height: 1.7;
        color: #334155;
        margin-bottom: 30px;
      }
      .card {
        background: rgba(255,255,255,0.82);
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 28px;
        padding: 28px 30px;
        box-shadow: 0 24px 60px rgba(15,23,42,0.08);
        backdrop-filter: blur(8px);
      }
      p {
        font-size: 19px;
        line-height: 1.85;
        margin: 0 0 18px;
        color: #1e293b;
      }
      strong {
        color: #0f172a;
      }
      .chips {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      .chip {
        padding: 8px 12px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid rgba(15,23,42,0.08);
        color: #0f766e;
        font-weight: 600;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <span class="eyebrow">Research Workflow</span>
      <h1>Capture the useful parts of the web before they disappear into the feed.</h1>
      <p class="lede">Fast note capture works best when the source, the summary, and the next action stay connected from the start.</p>
      <div class="card">
        <p id="target-text"><strong>Researchers remember tools that preserve context.</strong> The best tools keep the source, the takeaway, and the next action connected, so a note still makes sense days later when the tab is gone.</p>
        <p>When capture is instant, people save more. When review is clean, they actually come back. The winning product is usually the one that makes both moments feel obvious.</p>
        <p>That is why short AI summaries matter: they do not replace the source, they reduce the friction of coming back to it.</p>
        <div class="chips">
          <span class="chip">product/ux</span>
          <span class="chip">research</span>
          <span class="chip">ai-summary</span>
        </div>
      </div>
    </div>
  </body>
</html>`;

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/article')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(articleHtml);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function ensureCleanDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function clearDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function seedExtensionState(page) {
  await page.evaluate(async (notes) => {
    await chrome.storage.local.set({
      notetaker_notes: notes,
      notetaker_folders: ['business', 'citation', 'development', 'good-to-know', 'ideas', 'marketing', 'marketing/campaigns', 'marketing/examples', 'marketing/hooks', 'marketing/references', 'product', 'product/growth', 'product/ux', 'references', 'research', 'research/papers', 'retention'],
      notetaker_hidden_folders: [],
      notetaker_summary_tone: 'standard',
      notetaker_subscription: {
        plan: 'pro',
        trialStartedAt: null,
        trialEndsAt: null,
        isTrialActive: false,
        promoCodeApplied: null,
        source: 'pro',
        checkoutUrl: null,
        portalUrl: null,
        accountId: 'marketing-screenshot-user',
        accountEmail: 'creative@deepnote.app',
      },
      notetaker_enabled: true,
      notetaker_onboarding: {
        popupSeen: true,
        dashboardDismissed: true,
        completed: true,
        currentStep: 3,
      },
      notetaker_cloud_sync_meta: {
        lastSyncedAt: Date.now() - 1000 * 60 * 40,
        lastCloudBackupAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
      },
    });
  }, sampleNotes);
}

async function setupContext(context) {
  await context.route(`${apiOrigin}/api/billing/state*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        plan: 'pro',
        trialStartedAt: null,
        trialEndsAt: null,
        isTrialActive: false,
        promoCodeApplied: null,
        source: 'pro',
        checkoutUrl: null,
        portalUrl: null,
        accountId: 'marketing-screenshot-user',
        accountEmail: 'creative@deepnote.app',
      }),
    });
  });

  await context.route(`${apiOrigin}/api/chat`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: 'You saved a full swipe file here: hooks, campaign references, image notes, and examples that all point back to clearer marketing ideas.',
            },
          },
        ],
        relatedNoteIds: ['note-7', 'note-8'],
      }),
    });
  });

  await context.route(`${apiOrigin}/api/tag-suggestions`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tags: ['marketing/hooks', 'marketing/references', 'ideas'],
      }),
    });
  });

  await context.route(`${apiOrigin}/api/folder-suggestions`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        folder: 'marketing/references',
      }),
    });
  });
}

async function getExtensionOrigin(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 30000 });
    } catch {
      serviceWorker = null;
    }
  }

  const extensionId = serviceWorker ? new URL(serviceWorker.url()).host : fallbackExtensionId;
  return `chrome-extension://${extensionId}`;
}

async function createClipRecorder(name, fn, origin) {
  const tempVideoDir = path.join(outputDir, `.tmp-${name}`);
  await clearDir(tempVideoDir);

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), `deep-note-clip-${name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    await setupContext(context);
    const extensionOrigin = await getExtensionOrigin(context);
    const page = context.pages()[0] || await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await fn({ context, page, extensionOrigin, origin });

    await page.waitForTimeout(1200);
    const video = page.video();
    if (!video) {
      throw new Error(`No recorded video handle for ${name}`);
    }
    await page.close();
    const recordedPath = await video.path();
    await context.close();

    const targetPath = path.join(outputDir, `${name}.webm`)
    await fs.rm(targetPath, { force: true })
    await fs.copyFile(recordedPath, targetPath)
    await fs.rm(recordedPath, { force: true })
    await fs.rm(tempVideoDir, { recursive: true, force: true });
    await fs.rm(userDataDir, { recursive: true, force: true });
    return;
  } finally {
    if (context.pages().length > 0) {
      await context.close().catch(() => {});
    }
  }
}

async function generateHighlightClip({ page, extensionOrigin, origin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.waitForTimeout(500);
  await page.goto(`${origin}/article`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const el = document.getElementById('target-text');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.locator('text=Save to Deep Note').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.mouse.move(820, 355, { steps: 20 });
  await page.waitForTimeout(900);
  await page.mouse.move(920, 365, { steps: 20 });
  await page.waitForTimeout(1800);
}

async function generateCaptureOverlayClip({ page, extensionOrigin, origin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.waitForTimeout(500);
  await page.goto(`${origin}/article`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const el = document.getElementById('target-text');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Save to Deep Note' }).click();
  await page.locator('text=SMART SUGGESTIONS').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.mouse.move(820, 620, { steps: 18 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Advanced saving/i }).click();
  await page.waitForTimeout(900);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(700);
  await page.getByPlaceholder(/business, design, travel/i).fill('marketing/hooks, references');
  await page.waitForTimeout(1800);
}

async function generateMarketingKanbanClip({ page, extensionOrigin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.getByText(/^marketing$/i).first().click();
  await page.waitForTimeout(800);
  await page.getByTitle('Kanban View (Pro Feature)').click();
  await page.waitForTimeout(1200);

  await page.mouse.wheel(0, 450);
  await page.waitForTimeout(1000);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(2000);
}

async function generateAiChatClip({ page, extensionOrigin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /AI Chat/ }).click();
  await page.waitForTimeout(900);
  await page.getByPlaceholder('Ask about your notes...').fill('What did I save about marketing examples and campaign references?');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2600);
}

async function generateFolderSuggestionClip({ page, extensionOrigin, origin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.waitForTimeout(500);
  await page.goto(`${origin}/article`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const el = document.getElementById('target-text');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Save to Deep Note' }).click();
  await page.locator('text=SMART SUGGESTIONS').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Advanced saving/i }).click();
  await page.waitForTimeout(1000);
  await page.locator('text=AI suggested folder: marketing/references').waitFor({ timeout: 10000 });
  await page.waitForTimeout(2200);
}

async function generateChatReferenceClip({ page, extensionOrigin }) {
  await page.goto(`${extensionOrigin}/dashboard.html`);
  await page.waitForLoadState('domcontentloaded');
  await seedExtensionState(page);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /AI Chat/ }).click();
  await page.waitForTimeout(900);
  await page.getByPlaceholder('Ask about your notes...').fill('Which note has the image reference and campaign examples?');
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter');
  await page.locator('text=Related notes').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /\[1\].*UGC Creative Reference Board/i }).click();
  await page.waitForTimeout(2200);
}

async function main() {
  await ensureCleanDir(outputDir);
  const { server, origin } = await startServer();

  try {
    await createClipRecorder('clip-01-highlight-save', generateHighlightClip, origin);
    await createClipRecorder('clip-02-capture-overlay', generateCaptureOverlayClip, origin);
    await createClipRecorder('clip-03-marketing-kanban', generateMarketingKanbanClip, origin);
    await createClipRecorder('clip-04-ai-chat', generateAiChatClip, origin);
    await createClipRecorder('clip-05-folder-suggestion', generateFolderSuggestionClip, origin);
    await createClipRecorder('clip-06-chat-note-reference', generateChatReferenceClip, origin);
    console.log(`Video clips saved to ${outputDir}`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
