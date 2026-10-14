---
section: "AI Buddies"
section_order: 3
order: 2
downloadable: true
---

# Prompt para geração do AI Buddy

CHARACTER SHEET GENERATION PROMPT

Create a 2D vector-style cartoon character sheet based on the attached reference images.

The illustrations will be used as an AI buddy/avatar for RevenueHub, an Excel VSTO Copilot and skill management solution. The character will appear throughout the interface to guide users, explain concepts, present insights, answer questions, celebrate progress, support onboarding, and provide contextual help.

The illustrations will usually be displayed as relatively small UI assets, approximately 96–256 px. Generate the artwork at the highest available resolution so it remains crisp when downscaled.

==================================================
1. CONTEXT ISOLATION — CRITICAL
==================================================

Treat this request as visually isolated.

Use only:
1. The reference images explicitly attached to this request.
2. The instructions contained in this prompt.

Do not import, reuse, infer, or autocomplete any visual detail from:
- previous chats
- prior image generations
- conversational memory
- unrelated characters
- earlier clothing designs
- previous pose sheets not explicitly attached
- generic AI-assistant imagery

Do not add any feature merely because it appeared in another conversation or generation.

Do not add a mustache, beard, stubble, or any other facial hair unless it is clearly visible in Reference A. Any mustache shown in an earlier joke image or unrelated example is not canonical and must be ignored.

When a visual detail is already defined by the canonical reference image, preserve it instead of inventing a replacement.

==================================================
2. REFERENCE IMAGE ROLES
==================================================

The attached images may serve different purposes. Do not mix their roles.

REFERENCE A — CANONICAL CHARACTER

This is the original photograph or primary image of the person.

It defines:
- identity
- face
- facial structure
- hairstyle
- hair color
- eyebrow shape
- facial hair or lack of facial hair
- skin tone
- apparent age (50-60 yo)
- body proportions (heavier side of weight spectrum)
- body build (heavier side of weight spectrum)
- clothing
- clothing style
- clothing fit
- colors
- logos
- accessories
- watch, wristbands, jewelry, or other visible details

Reference A has the highest priority.

Reference A defines the person and clothing, but it does not define the illustration style.

REFERENCE B — ART-STYLE REFERENCE

This is an icon or converted illustration that represents the desired visual style.

It defines:
- line thickness
- outline treatment
- shape simplification
- facial simplification
- eye style
- shading level
- color treatment
- vector rendering
- head-to-body proportions
- overall icon appearance

Reference B defines the art style only.

Do not copy the identity, face, body, clothing, accessories, or character-specific details from Reference B unless they also exist in Reference A.

REFERENCE C — PREVIOUSLY CONVERTED CHARACTER EXAMPLES

These are successful converted images or character sheets of the same person.

They define:
- acceptable character consistency
- gesture language
- expression intensity
- pose complexity
- composition
- silhouette treatment
- spacing
- how the canonical person is simplified into the target style

Use Reference C as supporting guidance only.

Reference C must not override the face, body, clothing, accessories, or identity defined by Reference A.

The previous examples define pose and rendering consistency, but they do not authorize redesigning the canonical character.

==================================================
3. REFERENCE PRIORITY
==================================================

When references or instructions conflict, follow this order:

1. Reference A — Canonical Character
2. Clothing and accessories visible in Reference A
3. Editable Body Appearance settings
4. Reference B — Art Style
5. Reference C — Converted examples and pose language
6. Individual pose descriptions
7. Optional decorative elements

Never allow a lower-priority item to replace or contradict a higher-priority item.

When uncertain, preserve the canonical character rather than inventing a new interpretation.

==================================================
4. CHARACTER IDENTITY
==================================================

Every pose must depict the exact same individual shown in Reference A.

Maintain consistently:
- the same facial structure
- the same hairstyle and hairline
- the same eyebrow shape
- the same facial hair or clean-shaven appearance
- the same skin tone
- the same recognizable facial proportions
- the same apparent age
- the same body build
- the same clothing
- the same accessories

The person must be immediately recognizable as the same character in all ten poses.

Do not beautify, de-age, age up, slim down, bulk up, formalize, modernize, or redesign the person unless explicitly instructed in the Editable Body Appearance section.

==================================================
5. EDITABLE BODY APPEARANCE
==================================================

This section is intentionally editable. Change only the values inside brackets when adapting the prompt for another person.

Current settings (example):

- Build: [heavyset and bulky; clearly not thin]
- Apparent age: [50–60 years old]
- Face maturity: [mature complexion with subtle natural age and expression lines]
- Shoulders: [broad]
- Neck: [average to slightly thick]
- Arms: [sturdy]
- Hands: [large and expressive]
- Posture: [confident, relaxed, and approachable]
- Energy level: [professional, warm, and upbeat]

Apply these characteristics consistently across all poses without exaggeration.

These settings refine the canonical reference but must not make the character look like a different person. Reference A remains the final authority for body shape and age.

==================================================
6. CLOTHING — REFERENCE LOCKED
==================================================

The clothing visible in Reference A is canonical and must remain unchanged.

Preserve exactly:
- clothing category and style
- shirt, jacket, blazer, or outerwear type
- sleeve length
- neckline and collar
- fit and silhouette
- colors
- patterns
- logos
- text
- buttons, zippers, pockets, or lapels
- watch
- wristbands
- jewelry
- all other visible accessories

Do not:
- replace the original clothes
- simplify the outfit into a generic T-shirt
- add a blazer when the reference has none
- remove a blazer when the reference includes one
- substitute business attire
- add a hoodie, polo shirt, uniform, lab coat, futuristic suit, or generic AI-assistant outfit
- invent logos or text
- copy clothing from previous chats or unrelated examples

Only adjust folds, visibility, and perspective as naturally required by each pose.

==================================================
7. PERSONALITY AND ROLE
==================================================

The character is a friendly AI coworker inside RevenueHub.

He should feel:
- approachable
- knowledgeable
- attentive
- encouraging
- curious
- energetic
- optimistic
- trustworthy
- professional

Avoid making him feel like a childish mascot, superhero, comedian, salesperson, or science-fiction robot.

Expressions may be slightly exaggerated for small-size readability, but they must remain tasteful and suitable for enterprise software.

==================================================
8. ART STYLE
==================================================

Use a modern flat vector illustration style inspired by:
- Microsoft Office toolbar and ribbon icons
- enterprise software assistants
- polished SaaS onboarding illustrations
- corporate UI icon packs

Visual characteristics:
- clean vector-like shapes
- strong, smooth, consistent outlines
- simplified anatomy
- clear facial expressions
- slightly oversized head
- expressive but controlled hands
- minimal visual clutter
- soft cel shading
- subtle gradients only when necessary
- restrained corporate color treatment
- excellent silhouette readability
- consistent proportions across every pose

Do not use:
- photorealism
- semi-realistic portrait rendering
- anime
- manga
- comic-book inking
- painterly textures
- watercolor
- sketch lines
- 3D rendering
- plastic toy rendering
- dramatic cinematic lighting
- glow around the character
- drop shadows
- complex scenery
- decorative background patterns

Use a plain white background.

==================================================
9. SMALL-UI OPTIMIZATION
==================================================

The images will be used primarily at 96–256 px.

Therefore:
- prioritize silhouette over texture
- use clear expressions that survive downscaling
- avoid tiny facial details
- avoid thin lines
- avoid small props with unreadable detail
- keep hands and gestures easy to recognize
- keep the face unobstructed
- use strong separation between limbs and torso
- leave generous whitespace
- prevent cropping
- render at the highest available resolution for clean downscaling

Each pose must remain recognizable at 96×96 px and look polished at 128×128 px and 256×256 px.

==================================================
10. DEFAULT ORIENTATION AND DIRECTION
==================================================

The character should generally have his back or rear body direction toward the right side of the canvas while facing and gesturing toward the left.

For most poses:
- use a three-quarter view facing left
- angle the torso slightly toward the left
- direct the face and eyes toward the left
- direct pointing and presentation gestures toward the left
- keep the right/back side of the body closer to the right edge
- leave useful empty space on the left in front of the face or gesture
- align eye direction with the hand gesture or presented object
- never let hands cover the face

Use a mirrored or more frontal orientation only when the pose genuinely requires it.

==================================================
11. POSE SET — 10 POSES
==================================================

Create exactly ten distinct illustrations of the same character, in the exact order below.

TOP ROW, LEFT TO RIGHT:
1. Idle
2. Wave
3. Thinking
4. Writing
5. Happy

BOTTOM ROW, LEFT TO RIGHT:
6. Sad
7. Question
8. Eureka
9. Pointing
10. Celebrating

POSE 1 — IDLE

Label: Idle

- Relaxed standing or seated posture
- Friendly, subtle smile
- One arm resting naturally
- Other hand relaxed or slightly open
- Calm, attentive body language
- Ready to help
- No strong gesture
- No prop
- Default assistant-at-rest pose

POSE 2 — WAVE

Label: Wave

- One hand raised in a friendly greeting
- Open palm clearly visible
- Warm smile
- Relaxed posture
- Keep the raised hand fully inside its cell
- Do not let the hand approach or overlap the label area or neighboring cell

POSE 3 — THINKING

Label: Thinking

- One hand resting on the chin
- Other arm naturally supporting or resting
- Eyes looking slightly upward or toward the left
- Curious, reflective expression
- Keep the entire face visible
- Do not let the hand obscure the mouth, eyes, or defining facial features

POSE 4 — WRITING

Label: Writing

- Character seated or positioned behind a laptop
- Both hands typing naturally on the keyboard
- Focused but approachable expression
- Laptop must be simple, clean, and readable at small size
- Keep the laptop, arms, and hands entirely inside the illustration area
- Do not let the laptop or hands extend into the label area
- Do not include additional desk clutter, documents, or scenery

POSE 5 — HAPPY

Label: Happy

- Bright, confident smile
- Clear thumbs-up gesture
- Positive, enthusiastic posture
- Friendly and professional rather than exaggerated
- Keep the thumb and arm fully within the cell
- No confetti in this pose

POSE 6 — SAD

Label: Sad

- Head slightly lowered
- One hand resting on the forehead or side of the head
- Subdued, disappointed expression
- Sad but not devastated, distressed, or melodramatic
- Keep facial features readable
- Do not let the hand cover most of the face

POSE 7 — QUESTION

Label: Question

- One hand turned upward in a questioning gesture
- Curious, friendly expression
- Small floating question mark
- Question mark must remain inside the illustration area
- Question mark must not touch the character, cell boundary, neighboring pose, or label area
- Avoid making the character look alarmed or confused beyond recognition

POSE 8 — EUREKA

Label: Eureka

- One index finger raised
- Bright, confident smile
- Clear “I have an idea” expression
- Optional small lightbulb above or near the raised finger
- Lightbulb must remain simple and fully inside the illustration area
- Lightbulb must not overlap the character, neighboring pose, or label area

POSE 9 — POINTING

Label: Pointing

- Index finger clearly pointing toward the left
- Face and eyes looking toward the pointing direction
- Friendly, engaged expression
- Strong, readable pointing silhouette
- Leave useful empty space on the left side of the cell
- Keep the entire pointing hand and arm inside the cell
- Do not let the finger extend into the neighboring pose or label area

POSE 10 — CELEBRATING

Label: Celebrating

- Small applause or hands together in a restrained celebratory gesture
- Happy, upbeat expression
- Excited but still professional
- Optional minimal confetti
- Confetti must remain fully inside the illustration area
- Confetti must not overlap the face, body, cell boundary, neighboring pose, or label area

==================================================
12. SHEET LAYOUT AND COMPOSITION
==================================================

Produce one character sheet containing all ten poses.

Layout:
- two rows
- five columns
- ten equal-sized cells
- exact pose order defined in Section 11
- one pose per cell
- consistent scale across all cells
- consistent camera distance
- consistent head size
- consistent line thickness
- consistent shading
- consistent color palette
- consistent white background

Each cell must contain three vertically separated zones:

1. ILLUSTRATION ZONE
   - Use approximately the upper 72–76% of the cell.
   - The entire character, body parts, props, symbols, and effects must remain inside this zone.

2. EMPTY SAFETY GAP
   - Reserve approximately 6–8% of the cell height as completely empty white space.
   - Nothing may enter this gap.
   - This gap must visibly separate the illustration from its label.

3. LABEL ZONE
   - Reserve approximately the bottom 16–20% of the cell exclusively for the pose label.
   - Only the label may appear in this zone.

Mandatory spacing requirements:
- leave fair and clearly visible spacing between every pose
- leave fair and clearly visible spacing between every illustration and its label
- maintain equal horizontal gutters between all five columns
- maintain equal vertical spacing between the two rows
- preserve a white safety margin around every cell
- slightly reduce character size rather than allowing crowding
- all poses must have breathing room on every side

Hard non-overlap rules:
- no pose may overlap another pose
- no pose may cross into a neighboring cell
- no label may overlap an illustration
- no illustration may touch its label
- no label may overlap another label
- no prop or symbol may overlap a label
- no body part may enter the empty safety gap
- no body part, prop, symbol, or confetti may cross a cell boundary
- heads, hair, hands, fingers, elbows, clothes, laptops, lightbulbs, question marks, and confetti must remain fully contained
- do not crop any head, hand, finger, elbow, clothing edge, or prop

Additional composition requirements:
- center each character within the illustration zone
- keep every pose at a visually consistent scale
- maintain equal margins across all cells
- make every pose independently extractable as a square UI asset
- use no decorative frames or cell borders unless subtle guides are absolutely necessary for spacing
- do not add a title, legend, watermark, or any text other than the ten required labels

If the content does not fit comfortably, reduce the scale of all ten illustrations uniformly. Never solve a spacing problem by overlapping, crowding, or cropping.

==================================================
13. POSE LABELS
==================================================

Place one label centered below each pose, inside its dedicated label zone.

Use these exact labels, spell them exactly, and keep this exact order:

TOP ROW:
1. Idle
2. Wave
3. Thinking
4. Writing
5. Happy

BOTTOM ROW:
6. Sad
7. Question
8. Eureka
9. Pointing
10. Celebrating

Label requirements:
- clean sans-serif font
- dark gray or black text
- consistent font family
- consistent font size
- consistent font weight
- title case
- centered horizontally within its own cell
- fully contained inside the reserved label zone
- clearly separated from the illustration by the empty safety gap
- no intersection with any body part, prop, icon, effect, or neighboring label
- no misspellings
- no duplicated labels
- no omitted labels
- no extra punctuation
- no decorative typography
- readable when the complete sheet is reduced in size

If necessary, reduce the character scale uniformly to preserve generous separation. Never move a label into the illustration zone.

==================================================
14. COLOR AND RENDERING
==================================================

Use:
- skin, hair, clothing, logos, and accessories matching Reference A
- outline and shading treatment matching Reference B
- a restrained enterprise-friendly palette
- a plain white background

Do not recolor the canonical clothing merely to match a generic palette.

Do not introduce unrelated accent colors from previous chats or generations.

==================================================
15. CONSISTENCY CHECK
==================================================

Before finalizing, verify that:
- all ten illustrations depict the same person
- facial proportions remain consistent
- hairstyle and hairline remain consistent
- apparent age remains consistent
- body build remains consistent
- clothing remains exactly consistent with Reference A
- accessories remain consistent
- linework remains consistent
- pose scale remains consistent
- orientation generally faces left
- no mustache or other facial hair has been added unless it is visible in Reference A
- the pose order is exactly: Idle, Wave, Thinking, Writing, Happy / Sad, Question, Eureka, Pointing, Celebrating
- every label is correctly spelled
- every label is centered inside its own label zone
- a visible empty safety gap separates every illustration from its label
- no label overlaps or touches a pose
- no pose overlaps another pose
- no pose, prop, symbol, or label crosses a cell boundary
- no body part is cropped
- spacing is fair, consistent, and visibly generous
- the sheet remains readable at small size

==================================================
16. FINAL OUTPUT
==================================================

Generate one polished, high-resolution 10-pose character sheet arranged in two rows of five.

The result should look like a professional enterprise AI-assistant asset pack for RevenueHub, suitable for:
- Excel VSTO add-ins
- Copilot side panels
- skill management workflows
- onboarding screens
- contextual help
- dashboards
- notifications
- tutorials
- tooltips
- documentation
- achievement and success states

Every pose must work both as part of the full sheet and as an independently cropped small UI illustration.

Do not overlap poses, props, symbols, or labels. Provide fair, consistent, and clearly visible spacing between all poses and between every illustration and its label. Preserve the dedicated empty safety gap in every cell.

The final character must remain faithful to the canonical person, canonical clothing, and attached style references without importing visual details from any other chat or generation.