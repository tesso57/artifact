---------------------- MODULE ArtifactPathLockIsolation ----------------------
EXTENDS ArtifactPathLockProgress

\* TLC scenario: the blocker enters first and never releases. The target is
\* enqueued after that, on a different key. Another request can queue on
\* either path, including behind the blocker. Only the target's queue
\* gets progress fairness.
CONSTANTS Blocker, Target, BlockedPath

EnqueueTarget ==
    /\ Running(Blocker)
    /\ \E path \in Paths \ {BlockedPath} : Enqueue(Target, path)

IsolationNext ==
    \/ Enqueue(Blocker, BlockedPath)
    \/ EnqueueTarget
    \/ Running(Blocker) /\ \E op \in Operations \ {Blocker, Target}, path \in Paths : Enqueue(op, path)
    \/ \E op \in Operations : Enter(op)
    \/ \E op \in Operations \ {Blocker} : Release(op)

IsolationSpec ==
    /\ Init /\ [][IsolationNext]_vars
    /\ WF_vars(Enqueue(Blocker, BlockedPath)) /\ WF_vars(Enter(Blocker))
    /\ WF_vars(EnqueueTarget) /\ FairFor(Target)

StartsWhileBlocked == <>[](Running(Blocker) /\ Started(Target))

=============================================================================
