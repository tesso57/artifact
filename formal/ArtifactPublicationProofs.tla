----------------------- MODULE ArtifactPublicationProofs ----------------------
EXTENDS ArtifactPublication, ArtifactPathLockProofs

THEOREM PublicationInitialization == PublicationInit => PublicationInvariant
    BY SMT, Initialization DEF PublicationInit, PublicationInvariant, PublicationState,
        PublicationTypes, CommitOrder, SafeStamp, ExactReports

THEOREM LockTransition == [PublicationNext]_allVars => [Next]_vars
    BY DEF PublicationNext, Queue, Begin, Commit, Prepare, Unlock, BeginLoad, FinishLoad,
        Report, FinishObservation, allVars, Next

THEOREM PublicationPreservation == PublicationInvariant /\ [PublicationNext]_allVars => PublicationInvariant'
    <1> USE PublicationConstants DEF PublicationInvariant, PublicationState, PublicationTypes,
        allVars, publicationVars, vars, Invariant, TypeOK, Positions, UniqueTickets
    <1>1 ASSUME NEW op \in Operations, NEW path \in Paths, PublicationInvariant, Queue(op, path)
         PROVE PublicationState'
        <2> USE <1>1 DEF Queue, Enqueue, NewRequest
        <2>1 PublicationTypes' BY SMT
        <2>2 CommitOrder' BY SMTT(15) DEF CommitOrder
        <2>3 SafeStamp' BY SMTT(15) DEF CommitOrder, SafeStamp
        <2>4 ExactReports' BY SMT DEF ExactReports
        <2> QED BY <2>1, <2>2, <2>3, <2>4
    <1>2 ASSUME NEW op \in Operations, PublicationInvariant, Begin(op)
         PROVE PublicationState'
        <2> USE <1>2 DEF Begin, Enter
        <2>1 PublicationTypes' BY SMT
        <2>2 CommitOrder' BY SMTT(15) DEF CommitOrder
        <2>3 SafeStamp' BY SMTT(15) DEF CommitOrder, SafeStamp
        <2>4 ExactReports' BY SMT DEF ExactReports
        <2> QED BY <2>1, <2>2, <2>3, <2>4
    <1>3 ASSUME NEW op \in Operations, PublicationInvariant, Commit(op)
         PROVE PublicationState'
        <2> USE <1>3 DEF Commit
        <2>1 PublicationTypes' BY SMT
        <2>2 CommitOrder' BY SMTT(15) DEF CommitOrder
        <2>3 SafeStamp' BY SMTT(15) DEF CommitOrder, SafeStamp
        <2>4 ExactReports' BY SMT DEF ExactReports
        <2> QED BY <2>1, <2>2, <2>3, <2>4
    <1>4 ASSUME NEW op \in Operations, NEW watch \in BOOLEAN, PublicationInvariant, Prepare(op, watch)
         PROVE PublicationState'
        <2> USE <1>4 DEF Prepare
        <2>1 PublicationTypes' BY SMT
        <2>2 CommitOrder' BY SMTT(15) DEF CommitOrder
        <2>3 SafeStamp' BY SMTT(15) DEF CommitOrder, SafeStamp
        <2>4 ExactReports' BY SMT DEF ExactReports
        <2> QED BY <2>1, <2>2, <2>3, <2>4
    <1>5 ASSUME NEW op \in Operations, PublicationInvariant, Unlock(op)
         PROVE PublicationState'
        <2> USE <1>5 DEF Unlock, Release
        <2>1 PublicationTypes' BY SMT
        <2>2 CommitOrder' BY SMTT(15) DEF CommitOrder
        <2>3 SafeStamp' BY SMTT(15) DEF CommitOrder, SafeStamp
        <2>4 ExactReports' BY SMT DEF ExactReports
        <2> QED BY <2>1, <2>2, <2>3, <2>4
    <1>6 \A op \in Operations : PublicationInvariant /\ BeginLoad(op) => PublicationState'
        BY SMT DEF BeginLoad, CommitOrder, SafeStamp, ExactReports
    <1>7 \A op \in Operations : PublicationInvariant /\ FinishLoad(op) => PublicationState'
        BY SMT DEF FinishLoad, CommitOrder, SafeStamp, ExactReports
    <1>8 \A origin, token \in Operations : PublicationInvariant /\ Report(origin, token) => PublicationState'
        BY SMT DEF Report, CommitOrder, SafeStamp, ExactReports
    <1>9 \A op \in Operations : PublicationInvariant /\ FinishObservation(op) => PublicationState'
        BY SMT DEF FinishObservation, CommitOrder, SafeStamp, ExactReports
    <1>10 PublicationInvariant /\ UNCHANGED allVars => PublicationState'
        BY DEF CommitOrder, SafeStamp, ExactReports
    <1>11 PublicationInvariant /\ [PublicationNext]_allVars => PublicationState'
        BY <1>1, <1>2, <1>3, <1>4, <1>5, <1>6, <1>7, <1>8, <1>9, <1>10 DEF PublicationNext
    <1> QED BY <1>11, LockTransition, Preservation

THEOREM PublicationCorrectness == PublicationSpec => [](Safety /\ CommitOrder /\ SafeStamp /\ ExactReports)
    <1>1 PublicationSpec => []PublicationInvariant
        BY PTL, PublicationInitialization, PublicationPreservation DEF PublicationSpec
    <1>2 PublicationInvariant => Safety /\ CommitOrder /\ SafeStamp /\ ExactReports
        BY SMT DEF PublicationInvariant, PublicationState, Invariant, TypeOK, Positions, UniqueTickets,
            Safety, MutualExclusion, NoOvertaking
    <1> QED BY PTL, <1>1, <1>2

=============================================================================
