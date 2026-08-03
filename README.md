# Driftfield

**[Play it →](https://emmettl.github.io/driftfield/)**

A neon twin-stick shooter in the Geometry Wars / Asteroids line, where the arena is a fluid
simulation — and not decoratively. There is one velocity field, and everything reads from it: the
smoke over the arena is dye advected through it, the sparks are 65,000 tracers dropped into it, and
the grid the arena is drawn on displaces its vertices by it. So when a rock breaks, the floor bends
the same way the smoke goes, because they are the same numbers.

React Three Fiber, TypeScript, Vite, Vitest. Audio — effects *and* soundtrack — is synthesised at
runtime by [`@driftbox/engine`](https://github.com/emmettl/driftbox): a TR-808, a TR-909 and two
TB-303s built from their circuit topology. There are no audio assets, no textures, no models and no
fonts. The whole game is code.

> Named for the one thing that makes it different from every other twin-stick: there is a single velocity
> field, and the smoke, the sparks and the floor are all just things that read from it. The name lives in
> four places — `package.json`, `index.html`, the `overlay-title` in
> [`src/ui/Overlay.tsx`](src/ui/Overlay.tsx), and the `driftfield.best` localStorage key in
> [`src/game/useGameStore.ts`](src/game/useGameStore.ts) — so it is cheap to change again.
>
> The directory is still `geodrift/`; rename it whenever suits, nothing reads it.

## Running it

```bash
npm install
```

```bash
npm run dev
```

| | |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm test` | the whole suite, in Node, in under a second |
| `npm run lint` | oxlint |
| `npm run build` | typecheck, then a production bundle |

## Playing it

Move and aim are independent — that is the genre. Facing is where your shots go; travel is where the
thruster points, and the two being different is most of the skill.

| | |
| --- | --- |
| **WASD** | move |
| **Mouse** | aim, hold to fire |
| **Arrow keys** | aim *and* fire, for a keyboard-only player |
| **Shift / Space** | bomb |
| **Gamepad** | both sticks; the right stick is also the trigger |
| **Touch** | two sticks in space of their own — rails either side in landscape, a band below in portrait |

Whichever aim you used last wins, so a mouse and the arrow keys can be swapped between mid-wave
without a mode switch.

### On a phone

The controls get space of their own, and the playfield is what is left. That is not a stylistic choice:
sticks drawn *over* the arena — which is what the first version did — put your thumbs exactly where the
ship is, covering the two things you most need to see.

It costs real playfield, and the arena cannot be reshaped to pay for it. It is a fixed 120 × 68 because it
*is* the level: a player on one device must not be able to see enemies a player on another cannot. But
**which way round it is drawn is free**, and that is the idea the layout turns on. The camera can be rolled
a quarter turn so the arena's long axis runs *down* the screen — and because nothing about the simulation
changes, a player in portrait is looking at the same 120 × 68 arena as a player in landscape, rotated on the
glass. Same level, same spawns, same distances.

It matters more than anything else here. On a portrait phone the upright arena is a 430 × 244 strip across
the middle of a tall screen; rolled, it is 407 × 718 — **2.8 times the area**, at 5.98 pixels per world unit
against 3.58. In landscape the comparison reverses just as hard. So rather than guessing per device class,
both orientations are costed and the bigger one wins, and portrait needed no changes to `src/game` at all.

The controls then follow from the orientation. A rolled view is a tall screen and hands rest at the bottom
of a tall screen, so they get a band there. An upright view on a wide screen has slack at the sides and
thumbs that reach them, so they become rails — which costs the playfield nothing, since the arena is drawn
as large as the *tighter* axis allows and the looser axis was going spare. Either way one rule applies:
spend the slack first, and only take from the arena if the controls' minimum is not covered. Getting that
backwards was worth 126 pixels of playfield on a portrait phone.

Rails are deliberately never used on a tall screen even where they measure bigger. On a portrait tablet they
were two 88-pixel slivers pinned to the bezels with the bomb stranded in the bottom corner: 11% more
playfield than a band, and materially worse to hold. An area comparison alone will always get that wrong.

Two more things claw back pixels:

- **The canvas is fitted to the arena rather than the window.** Nearly half of a full-width canvas on a
  phone would be empty space beside the playfield — and every one of those pixels is still paid for
  by the bloom, the grade and the particle overdraw. Fitting the canvas to the arena's shape throws that
  cost away: on a 844 × 390 viewport it is about 43% fewer pixels to shade, which is the cheapest
  performance decision available on a phone. The strips either side become page background, and the grade
  ends up framing the playfield rather than the device.
- **No camera lean, so no margin to cover it.** The margin around the arena exists to keep the far wall in
  frame while the view leans towards the ship. A phone turns the lean off — there is not enough travel for
  it to register on a screen that size — and gets that margin back, worth about a tenth of the arena's
  drawn size.

The stick's travel is derived *from* the space its zone has rather than fixed independently, so the two
cannot disagree; and the HUD collapses to a single row along the top edge, which is the one band of the
arena you are rarely flying through.

All of it is decided by one pure function, [`resolveLayout`](src/game/layout.ts), because "does the
playfield end up a sensible size" is much easier to answer with a test than with a screenshot on one device.
The one thing it cannot answer is whether the sticks steer the right way once the view is rolled — a thumb
pushed up the glass has to become the arena's +x, and the sign has to agree with the camera. That is
[`unroll`](src/game/cameraFit.ts), tested against the roll angle itself rather than against a copy of it.

### What is shooting at you

Eight kinds, chosen so that every one asks a different question about how you are moving. Each is one
steering function in [`src/game/enemies.ts`](src/game/enemies.ts), and each is tested.

| | | |
| --- | --- | --- |
| **Drifter** | purple diamond | homes at you, slowly, in numbers |
| **Wanderer** | green octagon | ignores you completely and bounces off the walls; free points if you go and get them |
| **Weaver** | magenta pinwheel | homes at you, but sidesteps a bullet that is actually going to arrive — punishes spraying |
| **Snake** | yellow chain | a head that hunts with six segments behind it; kill the head and the whole chain goes |
| **Rock** | orange lump | ignores you, and splits into two faster ones when shot. The smallest leaves nothing |
| **Swarmer** | green triangle | never alone — a pack of eight that weave instead of tracking, so they fan out and arrive from several angles. You have to sweep rather than aim |
| **Sniper** | red pentagon | the only thing that shoots back. Holds its distance, strafes, and stops still for half a second before firing an aimed shot. Two hits to kill |
| **Well** | violet ring | a gravity well. Pulls you, your bullets, the geoms and the floor, and spits drifters until enough fire has gone into it to collapse it |

They arrive in a deliberate order: swarmers from wave 3, snipers from wave 6. A swarm teaches you to keep
moving; a sniper punishes you for standing still. Meeting the punishment first is how a player concludes a
game is unfair.

A sniper's round cannot be shot down — it is slow enough to see coming and to outrun, and telegraphed
before it leaves. Near a well it curves, which makes it the only projectile whose path you have to read
rather than predict.

**Three colour rules carry the whole roster**, and `shapes.test.ts` enforces all of them.

*Everything hostile is a fully saturated hue; the geoms are white.* Eight saturated hues are not reliably
distinguishable from each other, so the shapes do most of that work — corner count, and convex against
concave — but a pickup must never read as a threat, and reserving white for it means the distinction
survives a busy wave, a bloomed frame and peripheral vision.

*No enemy or projectile is blue or cyan.* The arena's own grid and walls are blue, so a blue enemy is
camouflaged against the floor it is crossing; and blue is the palest part of the wheel once the bloom has
had it, which put the two most numerous kinds within a shade of the white reserved for the pickups. The
player's bullets left the same band for the same reason and are now gold, which is also the highest
contrast available against a blue floor.

*Corner count is the cue that survives rotation.* Every enemy spins, so a square and a diamond are the
same shape a quarter of a second apart — which is how the drifter and the wanderer once ended up separated
by colour alone.

Waves come in three modes, announced on the banner because knowing what is coming is worth having:
**swarm** (the staple), **belt** (mostly rocks), and **singularity** (the wells — one wave in five).
The soundtrack changes for the last of these, which is the audible tell.

### Scoring

Everything that dies drops geoms. Four geoms is one step of the multiplier, which climbs to ×100 and
**resets when you die** — that rule is the game. With the multiplier kept, dying is a minor
inconvenience and the optimal play is to trade lives for position; losing it means a good run is a
long run.

A bomb clears the arena and pays, but drops no geoms — otherwise the best way to build a multiplier
is to hoard bombs and never learn to move. Extra life at 75,000 and every 125,000 after that, on a
widening interval so lives cannot compound into an unloseable run. A bomb every 100,000.

## How it is put together

The load-bearing split is that the game and the picture of the game are different programs.

```
src/game/      the simulation. No WebGL, no DOM, no AudioContext. Runs in Node under vitest.
src/gpu/       the fluid solver and the particle pool. Raw three.js, no React.
src/render/    geometry and the blast → splat conversion. Pure functions over three.js data.
src/components/ the React Three Fiber tree.
src/ui/        the HUD, overlays and touch controls, in ordinary DOM around the canvas.
src/songs/     three songs, written for this game, as data for the driftbox engine.
```

`src/game` is the whole game: [`step.ts`](src/game/step.ts) takes a world, an intent and a delta, and
moves everything. It draws nothing and plays nothing — instead it leaves a list of `Blast`es and
`SoundCue`s on `world.effects`, which [`GameLoop`](src/components/GameLoop.tsx) drains once a frame
into the fluid, the particle pool and the audio. That is why questions like *can a wave end while a
well is still alive* and *does a bomb pay out the multiplier* are answered in
[`step.test.ts`](src/game/step.test.ts) in a few milliseconds rather than by playing for twenty
minutes and hoping.

### The fluid

Stam's stable fluids on the GPU: splat, vorticity confinement, a Jacobi pressure solve, then
advection. Around a dozen full-screen passes over a 192×108 velocity grid every frame, with the dye
advected at twice that resolution because the dye is the part you look at.

Three consumers, one field:

- **Dye** → [`Backdrop`](src/components/Backdrop.tsx), tone-mapped so a fresh splat can clip to white
  while the smoke around it keeps its hue.
- **Velocity** → [`Arena`](src/components/Arena.tsx)'s grid, sampled in the vertex shader and used to
  displace the lattice. Every other game in this genre ripples its grid with a sine wave per
  explosion, which looks fine alone and wrong next to smoke, because the two are separate
  approximations of one event and they disagree about where the energy went.
- **Velocity and dye** → [`ParticleField`](src/gpu/particles.ts). The particles are tracers with no
  forces of their own, and they take their colour from the dye at their own position — so a kill's
  smoke and its sparks are one field sampled twice.

Everything the fluid does is *slow*: dye spreads over a second, sparks arc away over three. So an impact
also gets a fast layer that the fluid cannot provide — a white core gone in a tenth of a second and a ring
that overruns the blast and is gone in a quarter. See [`flashes.ts`](src/render/flashes.ts). Making a slow
thing bigger only makes it a bigger slow thing, which is why the first two attempts at "more punch" did not
work.

The attract screen has no kills and no wake, so the field would sit perfectly still behind the title — the
one screen where the thing that makes this game look the way it does is invisible. Every few seconds a
[wash](src/render/wash.ts) sweeps a band of dye and velocity across the arena and through the logo: a
column of splats advancing as a front, which the fluid then breaks up on its own.

Gravity is the deliberate exception: a well's pull is a short uniform array, not a splat into the
fluid. Splatting a steady inward velocity would mean fighting the pressure solve, which exists
precisely to cancel convergent flow.

The ship gets the same treatment, in the opposite direction — a dome it carries with it, pushing the
lattice outward where a well funnels it inward, so its own presence can never be mistaken for the most
dangerous thing in the game. It grows with the multiplier: the game has no powerup pickups, so the
multiplier is what "powered up" means here, and a good run is visible in the floor before you look at the
score. See [`warp.ts`](src/render/warp.ts).

Two details worth knowing before changing anything in [`src/gpu/`](src/gpu):

- Splats are **batched** into one pass with a uniform array. A bomb kills eighty things at once, and
  eighty passes over two fields is a dropped frame every time the player does the most dramatic thing
  available to them.
- A particle burst **claims a contiguous block of the pool** with a scissored draw into the state
  texture, rather than allocating from a free list. Knowing which particles are dead would mean
  reading the texture back, and a readback stalls the pipeline on every explosion.

Every field is a half-float render target, which needs `EXT_color_buffer_float`. Where that is
missing, `Fluid.available` is false and the game runs without smoke: the backdrop goes flat, the grid
warps from gravity only, and everything else is unaffected.

### Performance

Cost here is fill rate, not geometry — tens of thousands of additive sprites with the depth test off,
then a bloom chain over the whole frame. So the canvas opens at the highest pixel ratio that keeps a
frame inside a fixed budget and then follows the frame rate the machine actually achieves, walking
down on one that struggles and back up towards the display's native ratio on one that never was the
problem. See [`renderScale.ts`](src/game/renderScale.ts).

The fluid is the useful exception: it runs at its own fixed grid size, so it costs the same in a
postage stamp as it does full screen — a floor under the frame time rather than a slope.

### The sound of a hit

Three layers, and leaving any of them out is what "no punch" means: a **click** of bright high-passed noise
that the ear reads as impact rather than volume, a **body** dropping in pitch, and a **sub** below 80Hz that
you feel rather than hear. Attacks are immediate and decays exponential, because a ramp over 8ms is audible
as a soft onset and a linear fade sounds like a rumble.

The single biggest cause of weak explosions was none of that, though — it was the limiter. It had been set
up as a leveller with a 3ms attack and a ratio of 6, which catches and flattens the transient of every hit;
raising the gains made things *worse*, because it squashed them harder. It is now a seatbelt: 20ms attack,
gentle ratio, threshold high enough to do nothing until several things happen at once.

Everything sits in one generated room, at different distances — a kill is barely wet, a collapsing well is
the wettest thing in the game, and a sniper's shot is the driest so that it reads as *near* even when the
thing that fired it is not.

Clearing a wave is a **tritone**, struck as a dyad. It was a rising fifth, which is the most consonant
interval there is and says "well done, that's over"; a tritone is the one interval that refuses to resolve,
so it lands as *you survived, and something worse is coming* — which is what clearing a wave actually means
here. Both notes at once, because an interval played in sequence is a melody and an interval played
together is a colour.

### The beat

The arena reacts to the music, slightly. One low-band envelope follower on the engine's analyser produces a
single pulse, and the grid's brightness, the wall glow, the enemy tints and a very small camera breath all
read it — so they cannot disagree about where the beat is. See [`beat.ts`](src/game/beat.ts).

Two things about it are worth knowing before changing it. It reads the **analyser, not the transport**: the
transport schedules a bar ahead of what you can hear, so a visual driven from it leads the sound by up to a
second. And the bloom is never touched directly — the *scene* brightens and the glow follows, because
`@react-three/postprocessing` serialises its children to decide when to rebuild its pass chain, and putting
a ref on an effect kills the canvas with a circular-structure error on the second render.

### The soundtrack

Three songs, cued as a pure function of game state in
[`musicCue.ts`](src/game/musicCue.ts), and lifted in tempo as the waves climb — Swarm at 148 and
Swarm at 162 are recognisably the same record and unmistakably different situations, which is a
better use of fourteen beats a minute than a fourth arrangement would be.

| | |
| --- | --- |
| **Vector Lock** | the attract screen. 124bpm, no backbeat, a 303 arpeggio over a drone. The only swung thing here |
| **Swarm** | the waves. 148bpm, 909 four-on-the-floor, no sub — the bottom end belongs to the bomb |
| **Singularity** | the wells. 162bpm, an 808 kick, and a line built on the minor second |

They live here rather than among the engine's own presets because they are tuned against the
game: Swarm leaves the low end empty for the bomb, and Singularity hands the kick to the 808 because
that is the audible tell that the wave has changed. Neither decision makes sense for a song in a drum
machine. The engine's presets are still available and `songPresetById` takes any of their ids.

The engine and the songs are both loaded with a dynamic `import`, so the first thing a browser parses
on the way to the title screen is the game rather than a drum machine that may never be unmuted.

## Testing

344 tests, all in Node, all in about a second, because nothing worth testing here needs a GPU or
a browser.

```bash
npm test
```

What is actually pinned down is the reasoning rather than the plumbing: that a weaver dodges a bullet aimed
at it and ignores one going past, that a wave cannot end while a well is alive, that dying costs the
multiplier, that a sniper aims at where you are rather than leading you, that the spawn director cannot put
four wells on the field, that the camera fits the arena in a portrait window even once it has leaned
towards the ship, that a thumb pushed up the glass steers up the screen when the view is rolled a quarter
turn, and that every notated drum line in every song is exactly sixteen steps long.

Two of them play whole runs. One drives two simulated minutes with no input at all and insists the game
reaches a game over and stays there; the other fights back for two minutes and checks that nothing leaves
the arena or becomes `NaN`. Both assert the same invariant on every frame: a playable status always has a
ship in it. That invariant is there because it was once violated — a death that emptied the arena was being
converted into a wave clear by a stale flag, so the ship never respawned, and with no ship there were no
collisions, nothing could kill the player and the run could never end.

## Licence

MIT.
