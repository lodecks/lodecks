import { DeckId, DeckIds } from "@/common/constants/deck.constant";
import { Key, parseKey, shiftKey, transposeBetween } from "@/common/utils/music.util";

import { Automix } from "./modules/automix/automix.module";
import { Deck } from "./modules/deck/deck.module";
import { Catalog } from "./modules/importer/catalog.module";
import { Importer } from "./modules/importer/importer.module";
import { Live } from "./modules/live/live.module";
import { Analysis } from "./providers/analysis.provider";
import { Audio } from "./providers/audio.provider";
import { Compositor } from "./providers/compositor.provider";
import { Hydra } from "./providers/hydra.provider";
import { Stretch } from "./providers/stretch.provider";
import { Strudel } from "./providers/strudel.provider";
import { Transport } from "./providers/transport.provider";
import { Settings } from "./providers/settings.provider";
import { Visuals } from "./providers/visuals.provider";
import { Emitter, Store } from "./utils/store.util";

export type EngineState = { focus: DeckId };

class EngineFacade {
  audio = Audio;
  transport = Transport;
  strudel = Strudel;
  analysis = Analysis;
  stretch = Stretch;
  hydra = Hydra;
  visuals = Visuals;
  settings = Settings;
  compositor = Compositor;
  // every pack (server, browser, fresh imports) and the song importer
  catalog = Catalog;
  importer = Importer;

  decks = Object.fromEntries(
    DeckIds.map((id) => [id, new Deck(id)])
  ) as Record<DeckId, Deck>;

  store = new Store<EngineState>({ focus: "a" });

  // packs open in the pack editor, each on a deck of its own (never A or B)
  editors = new Map<string, Deck>();
  editorsChanged = new Emitter<void>();

  // transitions between the decks at the best moment
  automix = new Automix(this.decks);

  // the live language of /play: commands, widgets, layers, modules
  live: Live;

  constructor() {
    this.automix.onDone = (deck) => this.focus(deck);
    this.live = new Live(this);
  }

  get focused() {
    return this.decks[this.store.get().focus];
  }

  focus(id: DeckId) {
    this.store.set({ focus: id });
  }

  swapFocus() {
    this.focus(this.store.get().focus === "a" ? "b" : "a");
  }

  /**
   * The pack editor's copy of a pack, loaded once: editing it never
   * touches the decks. A new import's bytes come from the catalog.
   */
  openEditor(packId: string) {
    const open = this.editors.get(packId);
    if (open) return open;
    const deck = new Deck("a", true);
    this.editors.set(packId, deck);
    this.editorsChanged.emit();
    deck.store.set({ loading: true, packId });
    Catalog.ensureLocal(packId)
      .then((bytes) => deck.load({ id: packId, bytes }))
      .catch((error) => deck.store.set({ loading: false, error: (error as Error).message }));
    return deck;
  }

  /** Lets an editor's pack go (unsaved edits with it) */
  closeEditor(packId: string) {
    const deck = this.editors.get(packId);
    if (!deck) return;
    deck.eject();
    this.editors.delete(packId);
    this.editorsChanged.emit();
  }

  /** After a first save gave a fresh import its own id */
  renameEditor(from: string, to: string) {
    const deck = this.editors.get(from);
    if (!deck || from === to) return;
    this.editors.delete(from);
    this.editors.set(to, deck);
    this.editorsChanged.emit();
  }

  /** Loads a pack; the first one on a silent deck sets tempo and key */
  async load(id: DeckId, source: string | { id: string; bytes: Uint8Array }) {
    const deck = this.decks[id];
    // packs play from this browser: one only on the server downloads first
    if (typeof source === "string") {
      const packId = source;
      deck.store.set({ loading: true, packId, error: undefined });
      try {
        source = { id: packId, bytes: await Catalog.ensureLocal(packId) };
      } catch (error) {
        deck.store.set({ loading: false, error: (error as Error).message });
        return;
      }
    }
    const other = this.decks[id === "a" ? "b" : "a"];
    const pending = deck.load(source);

    const unsubscribe = deck.store.subscribe(() => {
      const pack = deck.store.get().pack;
      if (!pack) return;
      unsubscribe();

      if (!Transport.store.get().started && !other.store.get().pack) {
        Transport.setBpm(pack.bpm);
      }
    });

    await pending;
    unsubscribe();
    // the stretcher is needed as soon as tempos differ, compile it early
    if (Audio.store.get().ready) Stretch.warm();
  }

  eject(id: DeckId) {
    this.decks[id].eject();
  }

  async start() {
    await Strudel.start();
  }

  stop() {
    Transport.stop();
  }

  async toggle() {
    if (Transport.store.get().started) this.stop();
    else await this.start();
  }

  /**
   * Moves deck `id` onto a key, the other deck's as it sounds now when not
   * given (its relative major/minor counts: same notes), gliding over
   * `seconds`. Returns the transposition, or undefined with nothing to match.
   */
  syncKey(id: DeckId = this.store.get().focus, to?: Key, seconds = 0) {
    const deck = this.decks[id];
    const pack = deck.store.get().pack;
    const other = this.decks[id === "a" ? "b" : "a"].store.get();
    const target = to ?? (other.pack ? shiftKey(parseKey(other.pack.key), other.transpose) : undefined);
    if (!pack || !target) return undefined;
    const shift = transposeBetween(parseKey(pack.key), target);
    deck.glideTranspose(shift, seconds);
    return shift;
  }

  /** Takes the master tempo from the pack on a deck */
  syncTempo(id: DeckId = this.store.get().focus) {
    const pack = this.decks[id].store.get().pack;
    if (pack) Transport.setBpm(pack.bpm);
  }
}

export const Engine = new EngineFacade();
export type { Deck };
