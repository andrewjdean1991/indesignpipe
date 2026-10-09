#!/bin/zsh
# Installs the IDtoAE panel (dist/IDtoAE.jsx) into the newest After Effects
# version in your user preferences. Run it again after `git pull` to update.
set -e
HERE="${0:A:h}"
latest=""
for dir in "$HOME/Library/Preferences/Adobe/After Effects"/<->.<->(N/nOn); do
  latest="$dir"
  break
done
if [[ -z "$latest" ]]; then
  echo "No After Effects preferences folder found. Open After Effects once, then run this again."
  exit 1
fi
dest="$latest/Scripts/ScriptUI Panels"
mkdir -p "$dest"
rm -rf "$dest/IDtoAE"            # older two-part installs
cp "$HERE/dist/IDtoAE.jsx" "$dest/"
echo "Installed IDtoAE into $dest"
echo "Restart After Effects, then open Window > IDtoAE.jsx"
