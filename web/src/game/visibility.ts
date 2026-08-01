import type { ClientView, GameState } from './types'

export function toClientView(state: GameState, youId: string): ClientView {
  const you = state.players.find((p) => p.id === youId)
  const currentId = state.turnOrder[state.currentTurnIndex]
  const winner = state.players.find((p) => p.id === state.winnerId)

  let pending: ClientView['pendingDiscard'] = null
  if (state.pendingDiscard) {
    const disc = state.players.find((p) => p.id === state.pendingDiscard!.playerId)
    pending = {
      playerId: state.pendingDiscard.playerId,
      playerName: disc?.name ?? '',
      kind: state.pendingDiscard.kind,
      declare: state.pendingDiscard.declare,
      cardCount: state.pendingDiscard.cards.length,
      drawAmount: state.pendingDiscard.drawAmount,
      deadline: state.pendingDiscard.deadline,
      yourResponse:
        youId === state.pendingDiscard.playerId
          ? null
          : state.pendingDiscard.responders[youId] ?? 'pending',
    }
  }

  const isYourTurn = currentId === youId
  const canAct =
    state.phase === 'lobby'
      ? true
      : state.phase === 'ajimiWindow'
        ? Boolean(
            pending &&
              pending.playerId !== youId &&
              pending.yourResponse === 'pending',
          )
        : isYourTurn &&
          (state.phase === 'turnDraw' ||
            state.phase === 'turnDiscard' ||
            state.phase === 'turnCook' ||
            state.phase === 'turnEnd')

  return {
    youId,
    isHost: state.hostId === youId,
    phase: state.phase,
    hand: you?.hand ?? [],
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      score: p.score,
      ready: p.ready,
      connected: p.connected,
      isTurn: p.id === currentId && state.phase !== 'lobby' && state.phase !== 'finished',
    })),
    deckCount: state.deck.length,
    discardCount: state.discardPile.length,
    usedSingleDiscard: state.usedSingleDiscard,
    usedPairDiscard: state.usedPairDiscard,
    pendingDiscard: pending,
    winnerId: state.winnerId,
    winnerName: winner?.name ?? null,
    log: state.log,
    roomCode: state.roomCode,
    canAct,
  }
}
