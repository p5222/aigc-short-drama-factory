# Cine Card Motion Prompt

## Reference Breakdown

- Fullscreen cinematic video background with a center-weighted card stack floating over it.
- Cards are portrait-oriented, glassy, and slightly translucent, with cyan-green scanning corners and tiny camera HUD labels.
- The active card sits forward with higher scale, opacity, glow, and a centered scan label. Rear cards fan out diagonally, shrink, and rotate in 3D.
- Scene transitions feel like a film edit: background changes first with a soft crossfade, then the card stack settles into the new active card.
- Performance must prefer poster images for inactive cards and keep only the background buffer plus one delayed active-card video playing.

## Copy-Ready Prompt

Create a React + Tailwind + GSAP cinematic homepage card module for an AI comic-drama product called Manjiao. The module fills the viewport with a muted looping video background and a portrait-card stack in the lower-left. Use 5 cards. Each card has a high-quality poster image, title, mono HUD metadata, cyan-green focus corners, and glass reflection. Only the active card may render a playing video; inactive cards must render static poster images. The active card should float forward, scale up, glow cyan-green, and show a centered scan badge like `[ SHOT LOCKED ]`.

Interaction: on pointer movement over the stack, fan the cards horizontally with smooth GSAP quickSetter interpolation. Cards farther from the active index should move back in Z, reduce opacity, rotateY/rotateZ, and shift downward. On click, update the active card immediately with poster feedback, then crossfade the fullscreen background only after the next video has loaded a drawable frame. Use two background video elements as a double buffer. When a video becomes hidden or inactive, pause it, remove its src, and call load() to release decode/GPU resources. Delay active-card video playback until the background is stable, and skip card video for reduced-motion or save-data users.

Visual style: black cinematic base, no heavy gray overlay, crisp white hero typography, neon green camera-HUD accents, small monospace metadata, subtle bottom gradient for readability, no decorative blobs. The animation should feel like stacked film plates cutting through space: precise, glossy, restrained, and fast.

Performance requirements: encode videos as web-optimized H.264 MP4, no audio, faststart moov atom, 1080p maximum, 24-30fps, roughly 1.5-4.5 Mbps. Add long-lived cache headers for static media. Do not use fullscreen CSS filters on video; color grade in the video asset itself.
