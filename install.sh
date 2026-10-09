#!/bin/zsh
# Installs the IDtoAE panel into the newest After Effects version in your user prefs.
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
rm -rf "$dest/IDtoAE"
cp "$HERE/IDtoAE.jsx" "$dest/"
cp -R "$HERE/IDtoAE" "$dest/"
echo "Installed into $dest"
echo "Restart After Effects, then open Window > IDtoAE.jsx"
