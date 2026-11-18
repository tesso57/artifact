------------------------- MODULE ArtifactPathLockProofs -------------------------
EXTENDS ArtifactPathLock, TLAPS

THEOREM Initialization == Init => Invariant
    BY DEF Init, Invariant, NewRequest, TypeOK, Positions, UniqueTickets

THEOREM Preservation == Invariant /\ [Next]_vars => Invariant'
    <1> USE DEF Invariant, TypeOK, Positions, UniqueTickets, vars
    <1>1 \A op \in Operations, path \in Paths :
            Invariant /\ Enqueue(op, path) => Invariant'
        BY DEF Enqueue, NewRequest
    <1>2 \A op \in Operations : Invariant /\ Enter(op) => Invariant'
        BY DEF Enter
    <1>3 \A op \in Operations : Invariant /\ Release(op) => Invariant'
        BY DEF Release
    <1> QED BY <1>1, <1>2, <1>3 DEF Next

THEOREM Correctness == Spec => []Safety
    <1>1 Spec => []Invariant BY PTL, Initialization, Preservation DEF Spec
    <1>2 Invariant => Safety
        BY DEF Invariant, TypeOK, Positions, UniqueTickets, Safety, MutualExclusion, NoOvertaking
    <1> QED BY PTL, <1>1, <1>2

=============================================================================
