/*
 * Copyright 2020 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  packageExportTypeSchema,
  PackageRole,
  type BackstagePackageExport,
} from '@backstage/cli-node';
import { Project, SyntaxKind, ts, Type } from 'ts-morph';
import { resolve as resolvePath } from 'node:path';

export function getExportsMetadata(
  project: Project,
  role: PackageRole,
  dir: string,
  exportLocations: Record<string, string>,
): BackstagePackageExport[] {
  if (
    role !== 'backend-plugin' &&
    role !== 'backend-plugin-module' &&
    role !== 'frontend-plugin' &&
    role !== 'frontend-plugin-module' &&
    role !== 'frontend-extensions'
  ) {
    return [];
  }

  const exports: BackstagePackageExport[] = [];

  Object.entries(exportLocations).forEach(([exportLocation, filePath]) => {
    const fullFilePath = resolvePath(dir, filePath);
    const sourceFile = project.getSourceFile(fullFilePath);

    if (
      !sourceFile ||
      (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx'))
    ) {
      return;
    }

    for (const exportSymbol of sourceFile.getExportSymbols()) {
      const declaration = exportSymbol.getDeclarations()[0];
      const exportName = declaration.getSymbol()?.getName();
      let exportType: Type<ts.Type> | undefined;

      if (declaration) {
        if (declaration.isKind(SyntaxKind.ExportAssignment)) {
          exportType = declaration.getExpression().getType();
        } else if (declaration.isKind(SyntaxKind.ExportSpecifier)) {
          if (declaration.isTypeOnly()) {
            exportType = exportSymbol?.getDeclaredType();
          } else {
            exportType = declaration.getType();
          }
        } else if (declaration.isKind(SyntaxKind.VariableDeclaration)) {
          exportType = declaration.getType();
        }
      }

      if (exportName && exportType) {
        const exportMetadata = getExportMetadata(
          exportLocation,
          exportName,
          exportType,
        );

        if (exportMetadata) {
          exports.push(exportMetadata);
        }
      }
    }
  });

  return exports;
}

function getExportMetadata(
  exportPath: string,
  exportName: string,
  exportType: Type<ts.Type>,
): BackstagePackageExport | null {
  // Returns the concrete type of a generic type
  const genericType = exportType.getTargetType() ?? exportType;

  for (const property of genericType.getProperties()) {
    if (property.getName() === '$$type') {
      const typeValue = property
        .getValueDeclaration()
        ?.getText()
        .match(/(?<type>@backstage\/\w+)/);

      const { data, success } = packageExportTypeSchema.safeParse(
        typeValue?.groups?.type,
      );

      if (success) {
        const packageExport: BackstagePackageExport = {
          type: data,
        };

        if (exportName !== 'default') {
          packageExport.name = exportName;
        }

        if (exportPath !== '.') {
          packageExport.path = exportPath;
        }

        return packageExport;
      }
    }
  }

  return null;
}
