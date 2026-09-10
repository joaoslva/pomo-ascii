# pomo docs

The README is the short version. This is everywhere else.

## Using it

[Using it](usage.md) has the flags, the keys, the mouse, and what a session is
made of. [Settings](settings.md) covers the config file and the menu that edits
it, including the notification wording. Between those two you should never need
to read any source to work out what the thing does.

## How it looks

[Layout](layout.md) is about the three box sizes, the little 5 row digit font
and the two character sets. [Colour](colour.md) is the gradient, why it walks
the hue wheel instead of mixing RGB, and how it works out what your terminal
can actually display. [Sound](sound.md) covers the jingle, which is a WAV
synthesised in memory, and the desktop notifications that go with it.

## How it works

[Internals](internals.md) walks the modules, what each one is responsible for
and why the split is where it is. [Hacking on it](hacking.md) is the practical
side, running from source, the tests, the build.

If you want the shortest possible tour, read the session model and the
rendering split in [Internals](internals.md) and skip the rest. Those two ideas
explain most of the code.
