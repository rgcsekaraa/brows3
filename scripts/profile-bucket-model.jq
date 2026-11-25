# Specification model only: addresses, header hashes and keys are symbolic.
def initial($physical): {physical: $physical, creating: ($physical == "reserved"), header: "missing", token: false, writes: []};
def allowed: .physical == "reserved" and .header == "bound" and .token;
def step($event; $unsafe):
  if $event == "register" and .creating and .header == "missing" then .header = "bound" | .creating = false
  elif $event == "unlock" then .token = (.physical == "reserved" and .header == "bound")
  elif $event == "lock" then .token = false
  elif $event == "replace" then .header = "foreign" | .creating = false
  elif $event == "remove" then .header = "missing"
  elif $event == "unknown" then .header = "unreadable"
  elif ($event == "write" or $event == "retry") then
    if .physical == "legacy" or ($unsafe and .header == "missing") then .writes += ["plain"]
    elif allowed then .writes += ["sealed"] else . end
  elif $event == "unsupported" and .physical == "legacy" then .writes += ["plain"]
  else . end;
def events: "register", "unlock", "lock", "replace", "remove", "unknown", "write", "retry", "unsupported", "convert";
def states($depth):
  if $depth == 0 then .
  else . as $state | events as $event | $state | step($event; false) | states($depth - 1) end;
def valid($previous):
  .physical == $previous.physical and
  (if .physical == "reserved" then
     (.writes | index("plain") == null) and
     (if (.writes | length) > ($previous.writes | length) then ($previous | allowed) else true end)
   else true end);
["legacy", "reserved"] |
map(. as $physical |
    ([initial($physical) | states(3)] | unique) as $reachable |
    [$reachable[] as $before | events as $event | $before | step($event; false) |
      if valid($before) then 1 else error("unsafe transition: \($event)") end] | length) as $checked |
(initial("reserved") | step("write"; true)) as $counterexample |
if ($counterexample.writes != ["plain"]) then error("missing known counterexample")
else {model_transitions_checked: ($checked | add), mutant_missing_header_falls_back_to_plain: $counterexample} end
