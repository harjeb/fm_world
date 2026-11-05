# Third-party notices

## football2d

`src/ui/football2d-field.ts` adapts the layered grass and center-line Canvas rendering from [cyntler/football2d](https://github.com/cyntler/football2d), revision `e61ad7f` (`src/draw/field/parts/drawFieldGrass.ts`, `drawFieldCenterLines.ts`). It is adapted to Vite and our seven-a-side field proportions. FM world's result engine, event choreography, interpolation and playback queue are independently implemented; football2d's placeholder random ball simulation is not used.

MIT License

Copyright (c) 2021 Damian Cyntler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
