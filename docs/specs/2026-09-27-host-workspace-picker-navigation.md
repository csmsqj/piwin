# Host workspace picker navigation

The Desktop workspace picker browses the Host filesystem. Its sidebar shows
Host locations returned with the home-directory response from host/list-dir;
Desktop never enumerates its own disks for a remote Host.

- The toolbar retains Back and Forward as visited-path history. A separate
  Parent folder button follows the current listing's parentPath, even when
  the picker opened directly at a deep path. It is disabled at a filesystem
  root.
- The Locations group keeps Home and adds the Host's filesystem roots and
  mounted volumes. On macOS, the Host lists browsable mounts under /Volumes
  alongside /. On Windows, it lists ready drive roots. Other POSIX Hosts
  expose /, allowing GUI navigation to mount directories.
- HostListDirData.locations is optional for compatibility with older Hosts.
  The Host supplies it when listing home, which the picker already loads even
  when it opens at another path. A failed location discovery leaves the home
  drive available; a failed folder listing remains a visible picker error.
- Choosing a location or moving to a parent records a history visit. Neither
  action changes what the final Open/Choose button confirms.

Verification: targeted Host location and list-directory tests, Desktop picker
navigation tests, and workspace typecheck.
