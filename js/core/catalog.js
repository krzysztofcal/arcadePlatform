(function(global){
  'use strict';

  function isNonEmptyString(value){
    return typeof value === 'string' && value.trim().length > 0;
  }

  function normalizeLocaleBlock(block){
    const result = { en: '', pl: '' };
    if (block && typeof block === 'object'){
      if (isNonEmptyString(block.en)) result.en = block.en.trim();
      if (isNonEmptyString(block.pl)) result.pl = block.pl.trim();
    }
    if (!result.en && result.pl) result.en = result.pl;
    if (!result.pl && result.en) result.pl = result.en;
    return result;
  }

  function normalizeSource(source){
    const out = { type: 'placeholder' };
    if (!source || typeof source !== 'object') return out;
    const type = isNonEmptyString(source.type) ? source.type.trim() : null;
    if (type === 'self' || type === 'distributor' || type === 'placeholder'){
      out.type = type;
    }
    if (isNonEmptyString(source.page)) out.page = source.page.trim();
    if (isNonEmptyString(source.embedUrl)) out.embedUrl = source.embedUrl.trim();
    if (isNonEmptyString(source.distributor)) out.distributor = source.distributor.trim();
    if (out.type === 'self' && !out.page){
      out.type = 'placeholder';
    }
    if (out.type === 'distributor' && !out.embedUrl){
      out.type = 'placeholder';
    }
    return out;
  }

  const ORIENTATIONS = ['portrait', 'landscape', 'any'];

  function normalizeGame(raw){
    if (!raw || typeof raw !== 'object') return null;
    const id = isNonEmptyString(raw.id) ? raw.id.trim() : (isNonEmptyString(raw.slug) ? raw.slug.trim() : null);
    if (!id) return null;
    const slug = isNonEmptyString(raw.slug) ? raw.slug.trim() : id;
    const title = normalizeLocaleBlock(raw.title);
    if (!title.en) title.en = slug;
    if (!title.pl) title.pl = title.en;
    const description = normalizeLocaleBlock(raw.description);
    const category = Array.isArray(raw.category) ? raw.category.filter(isNonEmptyString).map(s => s.trim()) : [];
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(isNonEmptyString).map(s => s.trim()) : [];
    const thumbnail = isNonEmptyString(raw.thumbnail) ? raw.thumbnail.trim() : null;
    const source = normalizeSource(raw.source);
    const orientation = isNonEmptyString(raw.orientation) && ORIENTATIONS.includes(raw.orientation.trim())
      ? raw.orientation.trim()
      : 'any';
    return {
      id,
      slug,
      title,
      description,
      category,
      tags,
      thumbnail,
      source,
      orientation
    };
  }

  function normalizeGameList(raw){
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeGame).filter(Boolean);
  }

  global.ArcadeCatalog = Object.freeze({
    normalizeGame,
    normalizeGameList
  });
})(window);
