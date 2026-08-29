import { parseCityModelDocuments } from '@shared/cityModel/parseCityModel.js'

const yamlModules = import.meta.glob('../../overfit/city_model/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function relativeFromCityModel(filePath) {
  const norm = String(filePath).replace(/\\/g, '/')
  const marker = '/city_model/'
  const idx = norm.lastIndexOf(marker)
  if (idx >= 0) return norm.slice(idx + marker.length)
  return norm.replace(/^\.\.\//, '')
}

function yamlMapByPrefix(prefix) {
  const out = {}
  for (const [filePath, raw] of Object.entries(yamlModules)) {
    const rel = relativeFromCityModel(filePath)
    if (!rel.startsWith(prefix)) continue
    out[rel] = raw
  }
  return out
}

export function loadCityModelClient() {
  try {
    const cityRel = Object.keys(yamlModules).find((p) => relativeFromCityModel(p) === 'city.yaml')
    const cityYaml = cityRel ? yamlModules[cityRel] : ''
    return parseCityModelDocuments({
      cityYaml,
      contextYamls: yamlMapByPrefix('contexts/'),
      infrastructureYamls: {
        ...yamlMapByPrefix('infrastructure/'),
        ...yamlMapByPrefix('infrastructue/'),
      },
      actorYamls: yamlMapByPrefix('actors/'),
      dependencyYamls: yamlMapByPrefix('dependencies/'),
      sourcePath: 'overfit/city_model',
    })
  } catch {
    return null
  }
}
