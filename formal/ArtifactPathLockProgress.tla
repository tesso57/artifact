---------------------- MODULE ArtifactPathLockProgress -----------------------
EXTENDS ArtifactPathLock

Waiting(op) == requests[op].phase = "waiting"
Running(op) == requests[op].phase = "running"
Started(op) == requests[op].phase \in {"running", "done"}

HasTicket(op, path, ticket) ==
    /\ requests[op].key = path
    /\ requests[op].ticket = ticket

AtHead(op, path) == HasTicket(op, path, serving[path])

\* Each ticket from the head to the tail still has its owner. This is needed
\* for progress: unique tickets alone would also allow gaps in the queue.
NoGaps ==
    \A path \in Paths :
        \A ticket \in serving[path] .. (issued[path] - 1) :
            \E op \in Operations :
                HasTicket(op, path, ticket) /\ (Waiting(op) \/ Running(op))

QueueInvariant == Invariant /\ NoGaps

\* Model one pending call, its same-key predecessors, and their promise
\* continuations. Fairness for Enter means an eligible continuation runs.
\* Fairness for Release also assumes that the holder's callback settles
\* (returns or rejects), so the finally block runs. No fairness is imposed
\* on unrelated paths, on Enqueue, or on the target's callback settling.
EnterNeeded(target) ==
    /\ Waiting(target)
    /\ \E op \in Operations : AtHead(op, requests[target].key) /\ Enter(op)

ReleaseNeeded(target) ==
    /\ Waiting(target)
    /\ \E op \in Operations : AtHead(op, requests[target].key) /\ Release(op)

Advance(target) == EnterNeeded(target) \/ ReleaseNeeded(target)

EnterFair(target) == WF_vars(EnterNeeded(target))
ReleaseFair(target) == WF_vars(ReleaseNeeded(target))
FairFor(target) == EnterFair(target) /\ ReleaseFair(target)

StartProgress(target) == Waiting(target) ~> Started(target)
AllStart == \A op \in Operations : StartProgress(op)
FairSpec == Spec /\ \A op \in Operations : FairFor(op)

\* There are two steps for each predecessor (enter and release) and one for
\* the target. A running head has already taken its enter step.
HeadRunning(path) == \E op \in Operations : AtHead(op, path) /\ Running(op)

Work(target) ==
    IF Waiting(target)
    THEN LET path == requests[target].key
             ahead == requests[target].ticket - serving[path]
         IN 2 * ahead + (IF HeadRunning(path) THEN 0 ELSE 1)
    ELSE 0

AtWork(target, n) == Waiting(target) /\ Work(target) = n
LessWorkOrStarted(target, n) == Started(target) \/ (Waiting(target) /\ Work(target) < n)

=============================================================================
