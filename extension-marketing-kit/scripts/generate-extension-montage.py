"""Reusable base extracted from Deep Note.

Edit the clip filenames, scene timings, text overlays, and colors before using in another extension.
"""

from pathlib import Path

from moviepy import ColorClip, CompositeVideoClip, TextClip, VideoFileClip, concatenate_videoclips


PROJECT_ROOT = Path.cwd()
CLIPS_DIR = PROJECT_ROOT / "store-assets" / "video-clips"
OUTPUT_PATH = CLIPS_DIR / "deep-note-promo-montage.mp4"
SIZE = (1280, 720)
BACKGROUND = (12, 18, 32)
ACCENT = (20, 184, 166)

SCENES = [
    {
        "file": "clip-01-highlight-save.webm",
        "start": 0.55,
        "end": 5.2,
        "scale": 1.03,
        "offset": (-18, -10),
        "eyebrow": "HIGHLIGHT TO SAVE",
        "title": "Capture useful lines before they vanish into the feed.",
        "align": "left",
    },
    {
        "file": "clip-02-capture-overlay.webm",
        "start": 1.0,
        "end": 6.9,
        "scale": 1.06,
        "offset": (-34, -14),
        "eyebrow": "SMART SAVE FLOW",
        "title": "AI suggestions show up right inside the capture overlay.",
        "align": "left",
    },
    {
        "file": "clip-05-folder-suggestion.webm",
        "start": 1.1,
        "end": 6.7,
        "scale": 1.08,
        "offset": (-36, -28),
        "eyebrow": "FOLDER SUGGESTION",
        "title": "Deep Note can suggest the best folder before you even save.",
        "align": "left",
    },
    {
        "file": "clip-03-marketing-kanban.webm",
        "start": 0.8,
        "end": 6.0,
        "scale": 1.04,
        "offset": (-18, -8),
        "eyebrow": "VISUAL ORGANIZATION",
        "title": "Turn saved examples into a swipe file your team would actually use.",
        "align": "right",
    },
    {
        "file": "clip-04-ai-chat.webm",
        "start": 0.75,
        "end": 6.0,
        "scale": 1.04,
        "offset": (-20, -12),
        "eyebrow": "KNOWLEDGE CHAT",
        "title": "Ask across your notes instead of digging through tabs and folders.",
        "align": "right",
    },
    {
        "file": "clip-06-chat-note-reference.webm",
        "start": 0.95,
        "end": 6.15,
        "scale": 1.05,
        "offset": (-28, -14),
        "eyebrow": "RELATED NOTE LINKS",
        "title": "Jump straight from the answer to the exact note behind it.",
        "align": "left",
    },
]


def make_intro() -> CompositeVideoClip:
    bg = ColorClip(size=SIZE, color=BACKGROUND).with_duration(1.8)
    glow = ColorClip(size=(SIZE[0], 220), color=ACCENT).with_opacity(0.12).with_duration(1.8).with_position((0, 40))
    title = TextClip(
        text="Deep Note",
        font_size=72,
        color="white",
    ).with_duration(1.8).with_position((90, 230))
    subtitle = TextClip(
        text="Save fast. Review later.",
        font_size=34,
        color="#b6f3eb",
    ).with_duration(1.8).with_position((92, 320))
    kicker = TextClip(
        text="Highlights, AI suggestions, folders, and note-aware chat.",
        font_size=26,
        color="#cbd5e1",
    ).with_duration(1.8).with_position((92, 384))
    return CompositeVideoClip([bg, glow, title, subtitle, kicker], size=SIZE)


def make_caption_block(eyebrow: str, title: str, align: str, duration: float) -> CompositeVideoClip:
    width = 560
    height = 170
    x = 60 if align == "left" else SIZE[0] - width - 60
    y = 42

    panel = ColorClip(size=(width, height), color=(9, 15, 28)).with_opacity(0.82).with_duration(duration).with_position((x, y))
    accent = ColorClip(size=(width, 5), color=ACCENT).with_duration(duration).with_position((x, y))
    eyebrow_text = TextClip(
        text=eyebrow,
        font_size=22,
        color="#8df3e8",
    ).with_duration(duration).with_position((x + 26, y + 20))
    title_text = TextClip(
        text=title,
        font_size=34,
        color="white",
        method="caption",
        size=(width - 52, 100),
    ).with_duration(duration).with_position((x + 24, y + 54))

    return CompositeVideoClip([panel, accent, eyebrow_text, title_text], size=SIZE)


def make_scene(scene: dict) -> CompositeVideoClip:
    path = CLIPS_DIR / scene["file"]
    if not path.exists():
        raise FileNotFoundError(f"Missing clip: {path}")

    clip = VideoFileClip(str(path)).subclipped(scene["start"], scene["end"])
    duration = clip.duration

    motion = clip.resized(scene["scale"]).with_position(scene["offset"])
    caption = make_caption_block(scene["eyebrow"], scene["title"], scene["align"], duration)

    scene_clip = CompositeVideoClip([motion, caption], size=SIZE).with_duration(duration)
    clip.close()
    return scene_clip


def main() -> None:
    segments = []

    try:
        segments.append(make_intro())
        for scene in SCENES:
            segments.append(make_scene(scene))

        final_clip = concatenate_videoclips(segments, method="compose")
        final_clip.write_videofile(
            str(OUTPUT_PATH),
            codec="libx264",
            audio=False,
            fps=24,
            preset="medium",
            threads=4,
        )
        final_clip.close()
        print(f"Montage saved to {OUTPUT_PATH}")
    finally:
        for segment in segments:
            segment.close()


if __name__ == "__main__":
    main()
