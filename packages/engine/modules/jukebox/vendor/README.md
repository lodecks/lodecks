Vendored from https://github.com/rigdern/InfiniteJukeboxAlgorithm (MIT),
itself derived from The Eternal Jukebox by UnderMybrella, a rework of
Paul Lamere's Infinite Jukebox. See LICENSE.

Local change: `calculateNearestNeighbors(track, type)` takes the quantum
type so lodecks can branch on bars as well as beats. The walk logic of
`InfiniteBeats.js` is ported in `../walker.module.ts`.
