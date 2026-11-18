-------------------------- MODULE ArtifactPublication --------------------------
EXTENDS ArtifactPathLock

CONSTANTS Writes, Absent
ASSUME PublicationConstants == /\ Writes \subseteq Operations
                               /\ Absent \notin Operations

VARIABLES stage, disk, cache, stamp, observing, fetching, loaded, reports

publicationVars == <<stage, disk, cache, stamp, observing, fetching, loaded, reports>>
allVars == <<vars, publicationVars>>

\* A request stands for a unique save token or a delete. Disk records the
\* latest committed request, with a delete standing for absent files. Commit
\* abstracts the store's successful code + metadata writes or removal.
\* Prepare abstracts the locked MCP/cache updates, compile and stylesheet check
\* (for a delete, its cleanup). Release also represents failures. There is no
\* claim of filesystem atomicity, rollback after a committed failure, or
\* consistency across processes, aliases or out-of-band edits.
PublicationInit ==
    /\ Init
    /\ stage = [op \in Operations |-> "pending"]
    /\ disk = [path \in Paths |-> Absent]
    /\ cache = disk
    /\ stamp = disk
    /\ observing = {}
    /\ fetching = {}
    /\ loaded = {}
    /\ reports = {}

Queue(op, path) == Enqueue(op, path) /\ UNCHANGED publicationVars

Begin(op) ==
    /\ Enter(op)
    /\ stamp' = IF op \in Writes THEN [stamp EXCEPT ![requests[op].key] = Absent] ELSE stamp
    /\ UNCHANGED <<stage, disk, cache, observing, fetching, loaded, reports>>

Commit(op) ==
    LET path == requests[op].key
    IN /\ requests[op].phase = "running"
       /\ stage[op] = "pending"
       /\ stage' = [stage EXCEPT ![op] = "committed"]
       /\ disk' = [disk EXCEPT ![path] = op]
       /\ stamp' = [stamp EXCEPT ![path] = Absent]
       /\ UNCHANGED <<vars, cache, observing, fetching, loaded, reports>>

Prepare(op, watch) ==
    LET path == requests[op].key
        open == op \in Writes /\ watch
    IN /\ requests[op].phase = "running"
       /\ stage[op] = "committed"
       /\ stage' = [stage EXCEPT ![op] = "prepared"]
       /\ cache' = [cache EXCEPT ![path] = op]
       /\ stamp' = IF open THEN [stamp EXCEPT ![path] = op] ELSE stamp
       /\ observing' = IF open THEN observing \cup {op} ELSE observing
       /\ UNCHANGED <<vars, disk, fetching, loaded, reports>>

Unlock(op) == Release(op) /\ UNCHANGED publicationVars

\* A Vite load samples a token before reading source, and attaches it only
\* while that same token still owns tagging for the path. With serialized
\* daemon mutations and no external edits, the relevant bytes are stable
\* while a token is eligible. The implementation also checks the bytes.
\* Successful loads pair the source's origin with the token carried by the
\* browser's executed URL. Cached loads and delayed reports may outlive both
\* the write lock and the existence of the artifact.
BeginLoad(op) ==
    /\ op \in observing
    /\ stamp[requests[op].key] = op
    /\ fetching' = fetching \cup {op}
    /\ UNCHANGED <<vars, stage, disk, cache, stamp, observing, loaded, reports>>

FinishLoad(op) ==
    LET path == requests[op].key
    IN /\ op \in fetching
       /\ stamp[path] = op
       /\ loaded' = loaded \cup {<<disk[path], op>>}
       /\ UNCHANGED <<vars, stage, disk, cache, stamp, observing, fetching, reports>>

Report(origin, token) ==
    /\ <<origin, token>> \in loaded
    /\ token \in observing
    /\ reports' = reports \cup {<<origin, token>>}
    /\ UNCHANGED <<vars, stage, disk, cache, stamp, observing, fetching, loaded>>

FinishObservation(op) ==
    LET path == requests[op].key
    IN /\ requests[op].phase = "done"
       /\ op \in observing
       /\ observing' = observing \ {op}
       /\ stamp' = IF stamp[path] = op THEN [stamp EXCEPT ![path] = Absent] ELSE stamp
       /\ UNCHANGED <<vars, stage, disk, cache, fetching, loaded, reports>>

PublicationNext ==
    \/ \E op \in Operations, path \in Paths : Queue(op, path)
    \/ \E op \in Operations :
        Begin(op) \/ Commit(op) \/ (\E watch \in BOOLEAN : Prepare(op, watch)) \/ Unlock(op)
        \/ BeginLoad(op) \/ FinishLoad(op) \/ FinishObservation(op)
    \/ \E origin, token \in Operations : Report(origin, token)

PublicationSpec == PublicationInit /\ [][PublicationNext]_allVars

PublicationTypes ==
    /\ stage \in [Operations -> {"pending", "committed", "prepared"}]
    /\ disk \in [Paths -> Operations \cup {Absent}]
    /\ cache \in [Paths -> Operations \cup {Absent}]
    /\ stamp \in [Paths -> Writes \cup {Absent}]
    /\ observing \subseteq Writes
    /\ fetching \subseteq Writes
    /\ loaded \subseteq Writes \X Writes
    /\ reports \subseteq Writes \X Writes

CommitOrder ==
    /\ \A op \in Operations : stage[op] # "pending" => requests[op].phase \in {"running", "done"}
    /\ \A path \in Paths :
        LET last == disk[path]
        IN /\ last # Absent => requests[last].key = path /\ stage[last] # "pending"
           /\ (last # Absent /\ stage[last] = "prepared") => cache[path] = last
           /\ \A op \in Operations :
               (stage[op] # "pending" /\ requests[op].key = path) =>
               /\ last # Absent
               /\ requests[op].ticket <= requests[last].ticket
               /\ requests[op].phase = "running" => last = op

SafeStamp ==
    /\ \A op \in observing \cup fetching : stage[op] = "prepared"
    /\ \A path \in Paths :
        stamp[path] # Absent =>
            /\ stamp[path] \in observing
            /\ stamp[path] = disk[path]
            /\ stamp[path] = cache[path]
            /\ \A op \in Writes :
                 (requests[op].phase = "running" /\ requests[op].key = path) => op = stamp[path]

ExactReports ==
    \A origin, token \in Writes :
        <<origin, token>> \in loaded \cup reports => origin = token

PublicationState == PublicationTypes /\ CommitOrder /\ SafeStamp /\ ExactReports
PublicationInvariant == Invariant /\ PublicationState

=============================================================================
