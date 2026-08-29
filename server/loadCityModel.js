import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  aliasedModelPaths,
  parseCityModelDocuments,
} from '../shared/cityModel/parseCityModel.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CITY_MODEL_DIR = path.join(REPO_ROOT, 'overfit', 'city_model')

function listedRels(cityDoc, key) {
  const city = cityDoc?.city && typeof cityDoc.city === 'object' ? cityDoc.city : {}
  const listed = city[key] ?? cityDoc?.[key]
  if (!Array.isArray(listed)) return []
  return listed.map((item) => String(item).trim()).filter(Boolean)
}

function resolveOnDisk(cityDir, rel) {
  for (const candidate of aliasedModelPaths(rel)) {
    const abs = path.join(cityDir, candidate)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

function readListedYamls(cityDir, rels) {
  const files = {}
  for (const rel of rels) {
    const abs = resolveOnDisk(cityDir, rel)
    if (!abs) {
      console.warn(`City model file missing: ${rel}`)
      continue
    }
    const raw = fs.readFileSync(abs, 'utf8')
    files[rel] = raw
    const used = path.relative(cityDir, abs).split(path.sep).join('/')
    if (used && used !== rel) files[used] = raw
  }
  return files
}

export function loadCityModelFromDisk(cityDir = CITY_MODEL_DIR) {
  const manifestPath = path.join(cityDir, 'city.yaml')
  if (!fs.existsSync(manifestPath)) return null

  try {
    const cityYaml = fs.readFileSync(manifestPath, 'utf8')
    const cityDoc = parseYaml(cityYaml) ?? {}

    return parseCityModelDocuments({
      cityYaml,
      contextYamls: readListedYamls(cityDir, listedRels(cityDoc, 'contexts')),
      infrastructureYamls: readListedYamls(cityDir, listedRels(cityDoc, 'infrastructure')),
      actorYamls: readListedYamls(cityDir, listedRels(cityDoc, 'actors')),
      dependencyYamls: readListedYamls(cityDir, listedRels(cityDoc, 'dependencies')),
      sourcePath: cityDir,
    })
  } catch (err) {
    console.warn(`City model YAML failed to load: ${err.message}`)
    return null
  }
}
