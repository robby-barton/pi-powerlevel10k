# p10k-edge.zsh — edge cases: # in quotes, quotes, \u{...}, empty values,
# malformed lines, if-block indented typesets.

typeset -g POWERLEVEL9K_HASH_IN_QUOTES='a # not a comment # b'
typeset -g POWERLEVEL9K_DOUBLE_QUOTED="double ' single inside"
typeset -g POWERLEVEL9K_UNICODE_SEP='\u{E0B1}'
typeset -g POWERLEVEL9K_UNICODE_HEX='\u263A'
typeset -g POWERLEVEL9K_EMPTY=
typeset -g POWERLEVEL9K_UNQUOTED=42
this line is not an assignment === and is skipped
  typeset -g POWERLEVEL9K_INDENTED=7   # indented inside an if block
if [[ -n $FOO ]]; then
  typeset -g POWERLEVEL9K_IN_IF_BLOCK='%5F'
fi
typeset -g POWERLEVEL9K_BRACE_{A,B}_FOREGROUND=13
typeset -g POWERLEVEL9K_ONE_LINE_ARRAY=( alpha beta )   # same-line array
typeset -g POWERLEVEL9K_NAMED_COLOR=yellow
