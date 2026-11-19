------------------- MODULE ArtifactPathLockProgressProofs --------------------
EXTENDS ArtifactPathLockProgress, ArtifactPathLockProofs, WellFoundedInduction

THEOREM NoGapsInitially == Init => NoGaps
    BY SMT DEF Init, NoGaps

THEOREM NoGapsPreserved == QueueInvariant /\ [Next]_vars => NoGaps'
    <1> USE DEF QueueInvariant, Invariant, TypeOK, Positions, UniqueTickets, NoGaps,
        HasTicket, Waiting, Running, vars
    <1>1 \A op \in Operations, path \in Paths :
            QueueInvariant /\ Enqueue(op, path) => NoGaps'
        BY SMT DEF Enqueue, NewRequest
    <1>2 \A op \in Operations : QueueInvariant /\ Enter(op) => NoGaps'
        BY SMT DEF Enter
    <1>3 ASSUME NEW op \in Operations, QueueInvariant, Release(op)
         PROVE NoGaps'
        <2>1 ASSUME NEW path \in Paths, NEW ticket,
                    ticket \in serving'[path] .. (issued'[path] - 1)
             PROVE \E other \in Operations :
                 HasTicket(other, path, ticket)' /\ (Waiting(other)' \/ Running(other)')
            <3> USE <1>3, <2>1 DEF Release
            <3>1 /\ ticket \in serving[path] .. (issued[path] - 1)
                 /\ ~HasTicket(op, path, ticket)
                BY SMT
            <3>2 PICK other \in Operations : HasTicket(other, path, ticket) /\ (Waiting(other) \/ Running(other))
                BY SMT, <3>1
            <3> QED BY SMT, <3>1, <3>2
        <2> QED BY <2>1
    <1> QED BY <1>1, <1>2, <1>3 DEF Next

THEOREM QueueIsCovered == Spec => []QueueInvariant
    <1>1 Init => QueueInvariant
        BY Initialization, NoGapsInitially DEF QueueInvariant
    <1>2 QueueInvariant /\ [Next]_vars => QueueInvariant'
        BY Preservation, NoGapsPreserved DEF QueueInvariant
    <1> QED BY PTL, <1>1, <1>2 DEF Spec

THEOREM WaitingHasHead ==
    \A target \in Operations :
        QueueInvariant /\ Waiting(target) =>
            \E op \in Operations :
                AtHead(op, requests[target].key) /\ (Waiting(op) \/ Running(op))
    <1>1 ASSUME NEW target \in Operations, QueueInvariant, Waiting(target)
         PROVE \E op \in Operations :
             AtHead(op, requests[target].key) /\ (Waiting(op) \/ Running(op))
        <2> DEFINE path == requests[target].key
        <2>1 path \in Paths /\ serving[path] \in serving[path] .. (issued[path] - 1)
            BY SMT, <1>1 DEF path, QueueInvariant, Invariant, TypeOK, Positions, Waiting
        <2> QED BY <1>1, <2>1 DEF QueueInvariant, NoGaps, AtHead, path
    <1> QED BY <1>1

THEOREM PositiveWork ==
    \A target \in Operations :
        QueueInvariant /\ Waiting(target) => Work(target) \in Nat \ {0}
    BY SMT DEF QueueInvariant, Invariant, TypeOK, Positions, UniqueTickets, Work,
        HeadRunning, AtHead, HasTicket, Waiting, Running

CanEnter(target) == ENABLED <<EnterNeeded(target)>>_vars
CanRelease(target) == ENABLED <<ReleaseNeeded(target)>>_vars

THEOREM HeadCanEnter ==
    \A target \in Operations :
        QueueInvariant /\ Waiting(target) /\ ~HeadRunning(requests[target].key) => CanEnter(target)
    <1>1 ASSUME NEW target \in Operations,
                QueueInvariant, Waiting(target), ~HeadRunning(requests[target].key)
         PROVE CanEnter(target)
        <2>1 PICK op \in Operations : AtHead(op, requests[target].key) /\ Waiting(op)
            BY <1>1, WaitingHasHead DEF HeadRunning
        <2> DEFINE entered == [requests EXCEPT ![op].phase = "running"]
        <2>2 entered # requests
            BY SMT, <1>1, <2>1 DEF entered, Waiting, QueueInvariant, Invariant, TypeOK
        <2>3 issued' = issued /\ serving' = serving /\ requests' = entered => <<EnterNeeded(target)>>_vars
            BY SMT, <1>1, <2>1, <2>2 DEF EnterNeeded, Enter, AtHead, HasTicket, Waiting, vars, entered
        <2>4 ENABLED (issued' = issued /\ serving' = serving /\ requests' = entered)
            BY SMT, ExpandENABLED
        <2> QED BY SMTT(15), ExpandENABLED, Lambdify, <1>1, <2>1, <2>2, <2>3, <2>4
            DEF CanEnter, EnterNeeded, Enter, AtHead, HasTicket, Waiting, vars, entered
    <1> QED BY <1>1

THEOREM HeadCanRelease ==
    \A target \in Operations :
        QueueInvariant /\ Waiting(target) /\ HeadRunning(requests[target].key) => CanRelease(target)
    <1>1 ASSUME NEW target \in Operations,
                QueueInvariant, Waiting(target), HeadRunning(requests[target].key)
         PROVE CanRelease(target)
        <2>1 PICK op \in Operations : AtHead(op, requests[target].key) /\ Running(op)
            BY <1>1 DEF HeadRunning
        <2> DEFINE completed == [requests EXCEPT ![op].phase = "done"]
                   nextServing == [serving EXCEPT ![requests[op].key] = @ + 1]
        <2>2 completed # requests
            BY SMT, <1>1, <2>1 DEF completed, Running, QueueInvariant, Invariant, TypeOK
        <2>3 issued' = issued /\ serving' = nextServing /\ requests' = completed => <<ReleaseNeeded(target)>>_vars
            BY SMT, <1>1, <2>1, <2>2 DEF ReleaseNeeded, Release, AtHead, HasTicket,
                Waiting, Running, vars, nextServing, completed
        <2>4 ENABLED (issued' = issued /\ serving' = nextServing /\ requests' = completed)
            BY SMT, ExpandENABLED
        <2> QED BY SMTT(15), ExpandENABLED, Lambdify, <1>1, <2>1, <2>2, <2>3, <2>4
            DEF CanRelease, ReleaseNeeded, Release, AtHead, HasTicket, Waiting, Running, vars, nextServing, completed
    <1> QED BY <1>1

THEOREM WorkStaysWithoutAdvance ==
    \A target \in Operations :
        QueueInvariant /\ Waiting(target) /\ [Next]_vars /\ ~Advance(target) =>
            /\ Waiting(target)'
            /\ Work(target)' = Work(target)
            /\ (HeadRunning(requests[target].key)' <=> HeadRunning(requests[target].key))
    <1> USE DEF QueueInvariant, Invariant, TypeOK, Positions, UniqueTickets, Waiting, Running,
        Work, HeadRunning, HasTicket, AtHead, Advance, EnterNeeded, ReleaseNeeded, vars
    <1>1 \A target, op \in Operations, path \in Paths :
            QueueInvariant /\ Waiting(target) /\ Enqueue(op, path) =>
                /\ Waiting(target)'
                /\ Work(target)' = Work(target)
                /\ (HeadRunning(requests[target].key)' <=> HeadRunning(requests[target].key))
        BY SMT DEF Enqueue, NewRequest
    <1>2 \A target, op \in Operations :
            QueueInvariant /\ Waiting(target) /\ Enter(op) /\ ~Advance(target) =>
                /\ Waiting(target)'
                /\ Work(target)' = Work(target)
                /\ (HeadRunning(requests[target].key)' <=> HeadRunning(requests[target].key))
        BY SMT DEF Enter
    <1>3 \A target, op \in Operations :
            QueueInvariant /\ Waiting(target) /\ Release(op) /\ ~Advance(target) =>
                /\ Waiting(target)'
                /\ Work(target)' = Work(target)
                /\ (HeadRunning(requests[target].key)' <=> HeadRunning(requests[target].key))
        BY SMT DEF Release
    <1> QED BY SMT, <1>1, <1>2, <1>3 DEF Next

THEOREM AdvanceSpendsWork ==
    \A target \in Operations, n \in Nat :
        QueueInvariant /\ AtWork(target, n) /\ Advance(target) =>
            LessWorkOrStarted(target, n)'
    <1> USE DEF QueueInvariant, Invariant, TypeOK, Positions, UniqueTickets, Waiting, Running, Started,
        Work, HeadRunning, AtHead, HasTicket, AtWork, LessWorkOrStarted, Advance, EnterNeeded, ReleaseNeeded
    <1>1 \A target, op \in Operations, n \in Nat :
            QueueInvariant /\ AtWork(target, n) /\ AtHead(op, requests[target].key) /\ Enter(op) =>
                LessWorkOrStarted(target, n)'
        BY SMTT(15) DEF Enter
    <1>2 \A target, op \in Operations, n \in Nat :
            QueueInvariant /\ AtWork(target, n) /\ AtHead(op, requests[target].key) /\ Release(op) =>
                LessWorkOrStarted(target, n)'
        BY SMTT(15) DEF Release
    <1> QED BY <1>1, <1>2

OnLevel(target, n, held) ==
    /\ AtWork(target, n)
    /\ IF held THEN HeadRunning(requests[target].key) ELSE ~HeadRunning(requests[target].key)

AlwaysQueued == []QueueInvariant /\ [][Next]_vars

THEOREM FairWorkSpendsWork ==
    \A target \in Operations, n \in Nat :
        Spec /\ FairFor(target) => (AtWork(target, n) ~> LessWorkOrStarted(target, n))
    <1>1 ASSUME NEW target \in Operations, NEW n \in Nat
         PROVE Spec /\ FairFor(target) => (AtWork(target, n) ~> LessWorkOrStarted(target, n))
        <2> USE <1>1
        <2> DEFINE P(held) == OnLevel(target, n, held)
                   Q == LessWorkOrStarted(target, n)
        <2>1 QueueInvariant /\ AtWork(target, n) /\ ~Q' => ~Advance(target)
            BY SMT, AdvanceSpendsWork DEF Q
        <2>2 \A held \in {TRUE, FALSE} :
                QueueInvariant /\ [Next]_vars /\ P(held) /\ ~Advance(target) => P(held)'
            BY SMT, WorkStaysWithoutAdvance DEF P, OnLevel, AtWork
        <2>3 AlwaysQueued /\ FairFor(target) /\ AtWork(target, n) /\ []~Q => FALSE
            <3>1 AlwaysQueued /\ FairFor(target) /\ P(TRUE) /\ []~Q => FALSE
                <4>1 QueueInvariant /\ P(TRUE) => CanRelease(target)
                    BY HeadCanRelease DEF P, OnLevel, AtWork
                <4>2 QueueInvariant /\ [Next]_vars /\ P(TRUE) /\ ~Q' => P(TRUE)' /\ ~Advance(target)
                    <5>1 P(TRUE) => AtWork(target, n) BY DEF P, OnLevel
                    <5>2 QueueInvariant /\ [Next]_vars /\ P(TRUE) /\ ~Advance(target) => P(TRUE)'
                        BY SMT, <2>2
                    <5> QED BY <2>1, <5>1, <5>2
                <4>3 AlwaysQueued /\ P(TRUE) /\ []~Q => []P(TRUE) /\ [][~Advance(target)]_vars
                    BY PTL, <4>2 DEF AlwaysQueued
                <4>4 FairFor(target) /\ []CanRelease(target) => <> <<ReleaseNeeded(target)>>_vars
                    BY PTL DEF FairFor, ReleaseFair, CanRelease
                <4> QED BY PTL, <4>1, <4>3, <4>4 DEF AlwaysQueued, Advance
            <3>2 AlwaysQueued /\ FairFor(target) /\ P(FALSE) /\ []~Q => FALSE
                <4>1 QueueInvariant /\ P(FALSE) => CanEnter(target)
                    BY HeadCanEnter DEF P, OnLevel, AtWork
                <4>2 QueueInvariant /\ [Next]_vars /\ P(FALSE) /\ ~Q' => P(FALSE)' /\ ~Advance(target)
                    <5>1 P(FALSE) => AtWork(target, n) BY DEF P, OnLevel
                    <5>2 QueueInvariant /\ [Next]_vars /\ P(FALSE) /\ ~Advance(target) => P(FALSE)'
                        BY SMT, <2>2
                    <5> QED BY <2>1, <5>1, <5>2
                <4>3 AlwaysQueued /\ P(FALSE) /\ []~Q => []P(FALSE) /\ [][~Advance(target)]_vars
                    BY PTL, <4>2 DEF AlwaysQueued
                <4>4 FairFor(target) /\ []CanEnter(target) => <> <<EnterNeeded(target)>>_vars
                    BY PTL DEF FairFor, EnterFair, CanEnter
                <4> QED BY PTL, <4>1, <4>3, <4>4 DEF AlwaysQueued, Advance
            <3>3 AtWork(target, n) => P(TRUE) \/ P(FALSE)
                BY DEF P, OnLevel
            <3> QED BY PTL, <3>1, <3>2, <3>3
        <2>4 AlwaysQueued /\ FairFor(target) => (AtWork(target, n) ~> Q)
            BY PTL, <2>3 DEF AlwaysQueued, FairFor, EnterFair, ReleaseFair
        <2> QED BY <2>4, QueueIsCovered DEF Spec, AlwaysQueued, Q
    <1> QED BY <1>1

\* Apply this to any behavior by indexing its states with Nat, collecting
\* the times where Waiting and Started hold, and using Work as its rank.
\* PositiveWork and FairWorkSpendsWork give the premise SmallerOrStarted:
\* at each waiting time use that state's rank for n. This last connection
\* from temporal predicates to indexed sets of times is a semantic argument.
THEOREM NatMinimum ==
  ASSUME NEW S \in SUBSET Nat, S # {}
  PROVE  \E n \in S : \A m \in S : n <= m
  <1>1 \E n \in S : \A m \in S : <<m, n>> \notin OpToRel(<,Nat)
    BY SMT, WFMin, NatLessThanWellFounded
  <1> QED BY SMT, <1>1 DEF OpToRel

SmallerOrStarted(waiting, started, rank) ==
    \A t \in waiting :
        \/ \E later \in started : t <= later
        \/ \E later \in waiting : t < later /\ rank[later] < rank[t]

THEOREM TraceRankProgress ==
    ASSUME NEW waiting \in SUBSET Nat, NEW started \in SUBSET Nat,
           NEW rank \in [Nat -> Nat],
           SmallerOrStarted(waiting, started, rank)
    PROVE \A point \in waiting : \E later \in started : point <= later
<1>1 ASSUME NEW point \in waiting, ~ (\E later \in started : point <= later)
     PROVE FALSE
    <2> USE <1>1
    <2> DEFINE tail == { t \in waiting : point <= t }
               ranks == { rank[t] : t \in tail }
    <2>1 point \in tail BY SMT DEF tail
    <2>2 ranks \in SUBSET Nat /\ ranks # {} BY SMT, <2>1 DEF ranks, tail
    <2>3 PICK least \in ranks : \A n \in ranks : least <= n
        BY SMT, <2>2, NatMinimum
    <2>4 PICK t \in tail : rank[t] = least
        BY SMT, <2>3 DEF ranks
    <2>5 ~ (\E later \in started : t <= later)
        BY SMT, <2>4 DEF tail
    <2>6 PICK later \in waiting : t < later /\ rank[later] < least
        BY SMT, <2>4, <2>5 DEF SmallerOrStarted, tail
    <2>7 rank[later] \in ranks BY SMT, <2>4, <2>6 DEF ranks, tail
    <2> QED BY SMT, <2>3, <2>6, <2>7
<1> QED BY <1>1

=============================================================================
