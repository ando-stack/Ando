import {loadFont as loadAnton} from '@remotion/google-fonts/Anton';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';

export const {fontFamily: anton} = loadAnton();
export const {fontFamily: inter} = loadInter('normal', {weights: ['900']});

// Tempo: 100 BPM a 30 fps -> 18 frames por beat. Cambia BPM para cuadrarlo con la canción.
export const BPM = 100;
export const FPS = 30;
export const BEAT = Math.round((60 / BPM) * FPS);
export const BAR = BEAT * 4;

export const MONEY = '#7DB86A';
export const PURPLE = '#B14CFF';
export const PINK = '#FF2E88';
export const ICE = '#7FE7FF';
export const GOLD = '#F5C518';
