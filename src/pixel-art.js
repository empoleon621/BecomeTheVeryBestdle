import catalog from './sprite-catalog.json';
import extra from './graphics/extra-sprites.json';

const base = 'https://play.pokemonshowdown.com/sprites/';
const paldea = import.meta.glob('./paldea/*.webp', {eager: true, import: 'default'});
const community = 'https://raw.githubusercontent.com/Ghasty001/Animated_sprites_by_Ghasty001/25ab1b072dd2fdf96f5c85d503403317f33a857f/';

export function creaturePaths(id, back, animated) {
  const mask = catalog[id] ?? 0;
  const paths = [];
  const artist = extra[id];
  const paldeaFront = paldea['./paldea/' + id + '-front.webp'];
  const paldeaBack = paldea['./paldea/' + id + '-back.webp'];
  if (animated) {
    if (back && (mask & 2)) paths.push([base + 'gen5ani-back/' + id + '.gif', false, true]);
    if (back && paldeaBack) paths.push([paldeaBack, false, true]);
    if (back && artist?.[1]) paths.push([community + artist[1], false, true]);
    if (mask & 1) paths.push([base + 'gen5ani/' + id + '.gif', back, true]);
    if (paldeaFront) paths.push([paldeaFront, back, true]);
    if (artist?.[0]) paths.push([community + artist[0], back, true]);
  }
  if (back) paths.push([base + 'gen5-back/' + id + '.png', false, false]);
  paths.push([base + 'gen5/' + id + '.png', back, false]);
  return paths;
}

const roomFiles = import.meta.glob('./graphics/hall-*.png', {eager:true, import:'default'});
const characterFiles = import.meta.glob('./graphics/overworld/*.png', {eager:true, import:'default'});

export const corridorArt = round => roomFiles['./graphics/hall-' + round + '.png'];
export const trainerSprite = id => characterFiles['./graphics/overworld/' + id + '.png'];
export const idleFrame = characterFiles['./graphics/overworld/player-idle.png'];
export const walkFrames = [
  characterFiles['./graphics/overworld/player-step-0.png'],
  characterFiles['./graphics/overworld/player-step-1.png'],
];
