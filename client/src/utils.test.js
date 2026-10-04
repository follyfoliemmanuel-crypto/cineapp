import { describe, expect, it } from 'vitest';
import { formatDate, formatRuntime, formatScore, formatYear, imageUrl, initial, plural, posterSrcSet } from './utils.jsx';

describe('format', () => {
  it('formatYear', () => {
    expect(formatYear('2021-05-03')).toBe('2021');
    expect(formatYear(null)).toBe('');
    expect(formatYear('')).toBe('');
  });
  it('formatRuntime', () => {
    expect(formatRuntime(125)).toBe('2 h 05');
    expect(formatRuntime(60)).toBe('1 h 00');
    expect(formatRuntime(45)).toBe('45 min');
    expect(formatRuntime(0)).toBe('');
    expect(formatRuntime(null)).toBe('');
  });
  it('formatScore', () => {
    expect(formatScore(7.456)).toBe('7,5');
    expect(formatScore(10)).toBe('10,0');
    expect(formatScore(0)).toBe('');
    expect(formatScore(undefined)).toBe('');
  });
  it('formatDate', () => {
    expect(formatDate('2021-05-03')).toBe('3 mai 2021');
    expect(formatDate('pas une date')).toBe('');
    expect(formatDate(null)).toBe('');
  });
  it('plural / initial', () => {
    expect(plural(1, 'film', 'films')).toBe('1 film');
    expect(plural(3, 'film', 'films')).toBe('3 films');
    expect(initial(' zoé')).toBe('Z');
    expect(initial('')).toBe('?');
  });
});


describe('images', () => {
  it('construit une URL TMDB', () => {
    expect(imageUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(imageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
  });
  it('gère l’absence d’image', () => {
    expect(imageUrl(null)).toBeNull();
    expect(posterSrcSet(undefined)).toBeUndefined();
  });
  it('génère un srcset', () => {
    expect(posterSrcSet('/a.jpg')).toContain('w185/a.jpg 185w');
  });
});
