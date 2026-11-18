--------------------------- MODULE ArtifactPathLock --------------------------
EXTENDS Naturals

CONSTANTS Paths, Operations
VARIABLES issued, serving, requests

vars == <<issued, serving, requests>>

NewRequest == [phase |-> "new", key |-> {}, ticket |-> 0]

Init ==
    /\ issued = [path \in Paths |-> 0]
    /\ serving = [path \in Paths |-> 0]
    /\ requests = [op \in Operations |-> NewRequest]

\* viewer/server/path-lock.ts: a path is the lexical key from resolve(path).
\* A ticket records a call's position in the chain of pending promises for
\* that key. The counters model order, not implementation state.
\* All calls share one daemon's pending map. Filesystem aliases, other
\* processes, and unawaited work inside the callback are outside the model.
Enqueue(op, path) ==
    /\ requests[op] = NewRequest
    /\ requests' = [requests EXCEPT ![op] =
        [phase |-> "waiting", key |-> path, ticket |-> issued[path]]]
    /\ issued' = [issued EXCEPT ![path] = @ + 1]
    /\ UNCHANGED serving

\* The awaited predecessor has released, or no predecessor was pending.
Enter(op) ==
    LET req == requests[op]
    IN /\ req.phase = "waiting"
       /\ req.ticket = serving[req.key]
       /\ requests' = [requests EXCEPT ![op].phase = "running"]
       /\ UNCHANGED <<issued, serving>>

\* finally releases the successor after success or rejection.
Release(op) ==
    LET req == requests[op]
    IN /\ req.phase = "running"
       /\ serving' = [serving EXCEPT ![req.key] = @ + 1]
       /\ requests' = [requests EXCEPT ![op].phase = "done"]
       /\ UNCHANGED issued

Next ==
    \/ \E op \in Operations, path \in Paths : Enqueue(op, path)
    \/ \E op \in Operations : Enter(op) \/ Release(op)

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ issued \in [Paths -> Nat]
    /\ serving \in [Paths -> Nat]
    /\ requests \in [Operations -> [
        phase : {"new", "waiting", "running", "done"},
        key : Paths \cup {{}},
        ticket : Nat]]

Positions ==
    /\ \A path \in Paths : serving[path] <= issued[path]
    /\ \A op \in Operations :
        LET req == requests[op]
        IN req.phase # "new" =>
            /\ req.key \in Paths
            /\ req.ticket < issued[req.key]
            /\ IF req.phase = "done"
                  THEN req.ticket < serving[req.key]
                  ELSE serving[req.key] <= req.ticket
            /\ req.phase = "running" => req.ticket = serving[req.key]

UniqueTickets ==
    \A a, b \in Operations :
        LET first == requests[a]
            second == requests[b]
        IN /\ first.phase # "new"
           /\ second.phase # "new"
           /\ first.key = second.key
           /\ first.ticket = second.ticket
           => a = b

Invariant == TypeOK /\ Positions /\ UniqueTickets

MutualExclusion ==
    \A a, b \in Operations :
        /\ requests[a].phase = "running"
        /\ requests[b].phase = "running"
        /\ requests[a].key = requests[b].key
        => a = b

NoOvertaking ==
    \A earlier, later \in Operations :
        LET first == requests[earlier]
            second == requests[later]
        IN /\ first.phase # "new"
           /\ second.phase = "running"
           /\ first.key = second.key
           /\ first.ticket < second.ticket
           => first.phase = "done"

Safety == MutualExclusion /\ NoOvertaking

=============================================================================
