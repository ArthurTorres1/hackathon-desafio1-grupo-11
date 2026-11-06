import { assessConversion } from './rules.js';

export function reassessConversionWithException(input: {
  inputVolumeM3: string; outputVolumeM3: string; coefficient: string;
  parameterVersion: string; parameterSource: string; parameterValidFrom: string; parameterValidUntil?: string;
  assessmentDate: string; species: string; product: string;
  exception: { coefficient: string; approved: boolean; evidenceIds: string[]; validFrom: string; validUntil: string; species: string; product: string };
}) {
  return assessConversion({
    inputVolumeM3: input.inputVolumeM3, outputVolumeM3: input.outputVolumeM3,
    multiplier: input.coefficient, parameterVersion: input.parameterVersion, parameterSource: input.parameterSource,
    parameterValidFrom: input.parameterValidFrom, parameterValidUntil: input.parameterValidUntil,
    assessmentDate: input.assessmentDate, species: input.species, product: input.product,
    exception: {
      multiplier: input.exception.coefficient, approved: input.exception.approved,
      evidenceIds: input.exception.evidenceIds, validFrom: input.exception.validFrom,
      validUntil: input.exception.validUntil, expectedSpecies: input.exception.species,
      expectedProduct: input.exception.product,
    },
  });
}
