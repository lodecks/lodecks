/**
 * The live language, described once: every global and every method of
 * every handle. The runtime, autocomplete, hover docs and help() all
 * read this table.
 */
export type Kind = "deck" | "mixer" | "visual" | "signal" | "view" | "job" | "text";

// what a string argument can be, for completion
export type ArgValues =
  | "deck"
  | "pack"
  | "effect"
  | "gif"
  | "fx"
  | "band"
  | "stem"
  | "view"
  | "blend"
  | "shape"
  | "xfade"
  | "camera"
  | "fit"
  | "jukebox";

export type ApiDoc = {
  name: string;
  signature: string;
  doc: string;
  // what it returns, to complete what comes after a "."
  returns?: Kind;
  // completion for string arguments, by position
  args?: (ArgValues | undefined)[];
  // inline controls get an id from the runtime and draw in the line
  control?: boolean;
  // takes any number of the last argument, eg. solo("drums", "bass")
  rest?: boolean;
};

// handles carry their kind here, so completion knows what a variable holds
export const KindTag = "__kind";

export const Views = ["deck", "controls", "graph", "bars", "pads", "fx", "cues", "punch", "rain", "barcode", "stairs", "eq", "ring", "sections"];

/** deck.show(view): what each view is, in groups, for completion */
export const ViewGroups: { name: string; views: { view: string; doc: string }[] }[] = [
  {
    name: "controls",
    views: [
      { view: "deck", doc: "the whole deck: waveform, platter, buttons" },
      { view: "controls", doc: "song, sync, loop, infinite, key shift" },
      { view: "pads", doc: "the voice pads" },
      { view: "fx", doc: "the hold effects" },
      { view: "cues", doc: "the hot cues" }
    ]
  },
  {
    name: "the song",
    views: [
      { view: "graph", doc: "the infinite jukebox graph and its jumps" },
      { view: "bars", doc: "the waveform; click to jump" },
      { view: "sections", doc: "the whole song: its parts, cues and where it is" }
    ]
  },
  {
    name: "moving with the music",
    views: [
      { view: "punch", doc: "a punchcard sliding past the playhead" },
      { view: "rain", doc: "notes falling down lanes onto a hit line" },
      { view: "barcode", doc: "thin lines, one strip per layer" },
      { view: "stairs", doc: "a block per beat, as tall as the bass" },
      { view: "eq", doc: "a bouncing meter per layer, peaks held" },
      { view: "ring", doc: "this bar's 16 steps round a circle per layer" }
    ]
  }
];
export const BlendModes = ["normal", "add", "screen", "multiply"];
export const LfoShapes = ["sine", "tri", "saw", "square"];
export const Controls = ["slider", "knob", "toggle", "button", "pad"];

export const Globals: ApiDoc[] = [
  // decks and mixing
  { name: "deck", signature: 'deck("a" | "b")', doc: "a deck; .load(pack) puts a pack on it", returns: "deck", args: ["deck"] },
  { name: "mixer", signature: "mixer()", doc: "the mixer: crossfader, channels, auto mix", returns: "mixer" },
  { name: "xfade", signature: 'xfade(to, bars?)', doc: 'crossfader to "a", "b", "mid" or 0…1 (or a signal), gliding over bars', returns: "mixer", args: ["xfade"] },
  { name: "bpm", signature: "bpm(tempo?)", doc: "sets the master tempo, or reads it" },
  { name: "start", signature: "start()", doc: "starts the clock" },
  { name: "stop", signature: "stop()", doc: "stops the clock" },
  { name: "packs", signature: "packs(filter?)", doc: "lists the packs inline, with buttons to load them" },
  // time
  { name: "every", signature: "every(bars, fn)", doc: "runs fn on every bars-th bar, eg. every(16, () => a.jump(0))", returns: "job" },
  { name: "at", signature: "at(bar, fn)", doc: "runs fn once on bar (as shown in the top bar)", returns: "job" },
  { name: "next", signature: "next(fn, bars?)", doc: "runs fn once on the next bar (or the next multiple of bars)", returns: "job" },
  { name: "cancel", signature: "cancel()", doc: "cancels everything scheduled with every / at / next" },
  { name: "panic", signature: "panic()", doc: "stops the decks, schedules, glides and bindings (Ctrl+. twice)" },
  // live values
  { name: "kick", signature: "kick()", doc: "1 on a kick, falling to 0", returns: "signal" },
  { name: "fft", signature: "fft(band)", doc: "energy 0…1 of a band: 0 bass, 1 low mid, 2 high mid, 3 air", returns: "signal" },
  { name: "level", signature: 'level("a" | "b")', doc: "how loud a deck plays, 0…1", returns: "signal", args: ["deck"] },
  { name: "beat", signature: "beat()", doc: "0…1 across each beat", returns: "signal" },
  { name: "bar", signature: "bar()", doc: "the running bar count, with its fraction", returns: "signal" },
  { name: "lfo", signature: 'lfo(bars, min, max, shape?)', doc: 'swings min…max once every bars, "sine" | "tri" | "saw" | "square"', returns: "signal", args: [undefined, undefined, undefined, "shape"] },
  { name: "ramp", signature: "ramp(bars, from, to)", doc: "goes from → to over bars, then stays", returns: "signal" },
  // controls, drawn in the line
  { name: "slider", signature: "slider(value, min?, max?)", doc: "a slider in the line; drag it, the number in the code follows", returns: "signal", control: true },
  { name: "knob", signature: "knob(value, min?, max?)", doc: "a knob in the line; drag up / down", returns: "signal", control: true },
  { name: "toggle", signature: "toggle(on)", doc: "a switch in the line, 1 or 0", returns: "signal", control: true },
  { name: "pad", signature: 'pad("label"?, invert?)', doc: "a pad in the line: 1 while held, else 0; inverted, 0 while held", returns: "signal", control: true },
  { name: "button", signature: 'button("label", fn)', doc: "a button in the line that runs fn", control: true },
  // visuals
  { name: "viz", signature: 'viz("effect")', doc: "a visual effect, built in or your own (the effects menu)", returns: "visual", args: ["effect"] },
  { name: "glsl", signature: "glsl`…`", doc: "a Shadertoy-style shader: mainImage(), iTime, uKick, uFft, uBeat, iChannel0 (gif)…", returns: "visual" },
  { name: "hydra", signature: "hydra`…`", doc: 'hydra code: osc(10).kaleid(4).out() — fft(), kick(), gif(fit?) inside ("cover", "contain", "fill")', returns: "visual" },
  { name: "gif", signature: 'gif("name"?, fit?)', doc: 'a gif imported from the effects menu, on the beat; fit "cover" (default: fills, crops), "contain" (all of it) or "fill" (stretched)', returns: "visual", args: ["gif", "fit"] },
  { name: "camera", signature: 'camera("effect"?)', doc: 'the webcam as a visual: "raw", "matrix", "silhouette", "edges", "thermal", "halftone", "pixel", "glitch" (the browser asks first)', returns: "visual", args: ["camera"] },
  { name: "layers", signature: "layers(...visuals)", doc: "stacks visuals: the first at the bottom, each next one blended over it (.blend() / .opacity()); .over() adds to what plays instead", returns: "visual" },
  // views
  { name: "scope", signature: "scope()", doc: "the master waveform; .show() it", returns: "view" },
  { name: "spectrum", signature: "spectrum()", doc: "the master spectrum; .show() it", returns: "view" },
  { name: "meter", signature: 'meter("a" | "b")', doc: "a deck's level; .show() it", returns: "view", args: ["deck"] },
  { name: "marquee", signature: 'marquee("text")', doc: "text sliding past forever, on the tempo; .dance() makes it move; .show() it", returns: "text" },
  // helpers
  { name: "print", signature: "print(...values)", doc: "writes under the block" },
  { name: "help", signature: "help(name?)", doc: "the cheat sheet, or one entry" },
  { name: "reset", signature: "reset()", doc: "forgets the variables the code made" }
];

const showDoc = (what: string): ApiDoc => ({ name: "show", signature: "show()", doc: `shows ${what} under this line`, returns: undefined });

export const Methods: Record<Kind, ApiDoc[]> = {
  deck: [
    { name: "load", signature: 'load("pack")', doc: "loads a pack (id or part of its title), once", returns: "deck", args: ["pack"] },
    { name: "play", signature: "play()", doc: "starts the song on the next phrase (and the clock)", returns: "deck" },
    { name: "stop", signature: "stop()", doc: "stops the song", returns: "deck" },
    { name: "sync", signature: "sync()", doc: "master tempo = this pack's tempo", returns: "deck" },
    { name: "jump", signature: "jump(bar)", doc: "jumps to bar on the next quantize point", returns: "deck" },
    { name: "cue", signature: "cue(n)", doc: "jumps to hot cue n (1–8), or sets it", returns: "deck" },
    { name: "loop", signature: "loop(bars)", doc: "loops the song over bars; 0 lets go", returns: "deck" },
    { name: "infinite", signature: 'infinite(on?, "bar" | "beat"?, "low" | "mid" | "high"?)', doc: 'infinite jukebox: plays the song forever, branching between bars that sound alike; "beat" branches on beats, "low" / "high" sets how often; infinite(false) plays it straight', returns: "deck", args: ["jukebox", "jukebox", "jukebox"] },
    { name: "branch", signature: "branch()", doc: "infinite: branches to a similar spot at the next boundary", returns: "deck" },
    { name: "transpose", signature: "transpose(semitones, bars?)", doc: "shifts the pitch, keeping the tempo; gliding over bars if given", returns: "deck" },
    { name: "tune", signature: 'tune(to?, bars?)', doc: 'glides into the other deck\'s key (or its relative major/minor) over bars (1); to: "a", "b" or a key like "Am"; "off" goes back; 0 bars jumps', returns: "deck" },
    { name: "untune", signature: "untune(bars?)", doc: "glides back to the song's own pitch over bars (1); 0 jumps", returns: "deck" },
    { name: "vol", signature: "vol(level)", doc: "volume 0…1, or a signal", returns: "deck" },
    { name: "eq", signature: 'eq("low" | "mid" | "high", gain)', doc: "eq −1…1, or a signal", returns: "deck", args: ["band"] },
    { name: "filter", signature: "filter(amount)", doc: "−1 low pass … 0 open … 1 high pass, or a signal", returns: "deck" },
    { name: "fx", signature: 'fx("name", on?)', doc: "echo, reverb, stutter, gate, brake, filter", returns: "deck", args: ["fx"] },
    { name: "mute", signature: 'mute("track"?, on?)', doc: "silences a track (drums, bass, other, vocals) in time with the song; on can be a signal, eg. toggle() or pad(); no name mutes them all", returns: "deck", args: ["stem"] },
    { name: "unmute", signature: 'unmute("track"?)', doc: "brings a track back; no name brings back them all", returns: "deck", args: ["stem"] },
    { name: "solo", signature: 'solo("track", …, on?)', doc: "plays only these tracks; on last can be a signal, eg. solo(\"vocals\", pad()) solos while held; solo() plays them all again", returns: "deck", args: ["stem"], rest: true },
    { name: "stem", signature: 'stem("name", on?)', doc: "starts or stops a track on the next quantize point (mute() cuts it at once)", returns: "deck", args: ["stem"] },
    { name: "take", signature: "take(bars?, cue?)", doc: "takes over from the other deck at the best moment: a blend of bars (16), landing on hot cue n if given", returns: "deck" },
    { name: "show", signature: 'show(view?)', doc: 'shows the deck here: "deck", "controls" (song, sync, loop, infinite, key), "graph" (jukebox), "bars", "pads" (voices), "fx" (hold effects), "cues" (hot cues) — or moving with the song: "punch" (punchcard), "rain" (falling bars), "barcode", "stairs", "eq", "ring", "sections"', returns: "deck", args: ["view"] },
    { name: "hide", signature: "hide()", doc: "removes what show() drew", returns: "deck" }
  ],
  mixer: [
    { name: "xfade", signature: "xfade(to, bars?)", doc: 'crossfader to "a", "b", "mid", 0…1 or a signal', returns: "mixer", args: ["xfade"] },
    { name: "master", signature: "master(level)", doc: "master volume 0…1, or a signal", returns: "mixer" },
    { ...showDoc("the mixer"), returns: "mixer" }
  ],
  visual: [
    { name: "blend", signature: 'blend("normal" | "add" | "screen" | "multiply")', doc: "how it mixes with what is below", returns: "visual", args: ["blend"] },
    { name: "opacity", signature: "opacity(amount)", doc: "0…1, or a signal like kick()", returns: "visual" },
    { name: "show", signature: "show()", doc: "shows it under this line, in place of the visuals playing", returns: "visual" },
    { name: "over", signature: "over()", doc: "puts it on top of the visuals playing, keeping them, and shows it under this line; hide() takes it off", returns: "visual" },
    { name: "full", signature: "full()", doc: "the visuals over the whole screen (Esc leaves)", returns: "visual" },
    { name: "background", signature: "background(dim?)", doc: "the visuals behind everything, under the code; dim 0…1 darkens them (0.6), background(false) removes", returns: "visual" },
    { name: "hide", signature: "hide()", doc: "removes what show() drew", returns: "visual" }
  ],
  signal: [
    { name: "mul", signature: "mul(x)", doc: "multiplies by a number or signal", returns: "signal" },
    { name: "add", signature: "add(x)", doc: "adds a number or signal", returns: "signal" },
    { name: "range", signature: "range(min, max)", doc: "maps 0…1 onto min…max", returns: "signal" },
    { name: "smooth", signature: "smooth(amount?)", doc: "softens changes, 0…1", returns: "signal" },
    { name: "read", signature: "read()", doc: "the value right now" }
  ],
  view: [
    { ...showDoc("it"), returns: "view" },
    { name: "hide", signature: "hide()", doc: "removes it", returns: "view" }
  ],
  job: [{ name: "cancel", signature: "cancel()", doc: "stops this schedule" }],
  text: [
    { name: "dance", signature: "dance(amount?)", doc: "the letters bounce on the beat and jump on the kick; 0…2 (1), 0 stops", returns: "text" },
    { name: "speed", signature: "speed(bars)", doc: "bars for the text to slide by once (2); negative goes the other way", returns: "text" },
    { name: "size", signature: "size(px)", doc: "letter size in pixels (56)", returns: "text" },
    { name: "color", signature: 'color("a" | "b" | "code" | "#hex")', doc: "deck A green, deck B rose, code purple, or any colour", returns: "text" },
    { name: "text", signature: 'text("new text")', doc: "changes the words, live", returns: "text" },
    { name: "show", signature: "show()", doc: "shows it under this line", returns: "text" },
    { name: "hide", signature: "hide()", doc: "removes it", returns: "text" }
  ]
};

/** Docs for a name: a method of `kind` first, then any global, then any method */
export const docFor = (name: string, kind?: Kind) =>
  (kind && Methods[kind].find((doc) => doc.name === name)) ||
  Globals.find((doc) => doc.name === name) ||
  Object.values(Methods)
    .flat()
    .find((doc) => doc.name === name);

/** What a global call returns */
export const returnsOf = (name: string, kind?: Kind) =>
  kind ? Methods[kind].find((doc) => doc.name === name)?.returns : Globals.find((doc) => doc.name === name)?.returns;
