import Decimal from 'decimal.js';
import { ValidationError } from '../lib/errors';

export interface ConvertedQuantity {
  uom: Decimal;
  uoo: Decimal;
}

export class UnitConversionService {
  /**
   * Convert a quantity from UoM to UoO.
   * UoO = UoM × conversionFactor
   */
  toUoO(quantityInUoM: Decimal, conversionFactor: Decimal): Decimal {
    return quantityInUoM.mul(conversionFactor);
  }

  /**
   * Convert a quantity from UoO back to UoM.
   * UoM = UoO ÷ conversionFactor
   */
  toUoM(quantityInUoO: Decimal, conversionFactor: Decimal): Decimal {
    if (conversionFactor.isZero()) {
      throw new ValidationError(
        'Conversion factor cannot be zero',
        'This asset has an invalid conversion factor (0). Please edit the asset.',
      );
    }
    return quantityInUoO.div(conversionFactor);
  }

  /**
   * Produce both UoM and UoO values for a count quantity.
   */
  convert(quantityInUoM: Decimal, conversionFactor: Decimal): ConvertedQuantity {
    return {
      uom: quantityInUoM,
      uoo: this.toUoO(quantityInUoM, conversionFactor),
    };
  }

  /**
   * Format a Decimal quantity for display, stripping unnecessary trailing zeros.
   * e.g. format(new Decimal('12.50'), 'tote') → '12.5 tote'
   *      format(new Decimal('12.00'), 'each') → '12 each'
   */
  format(quantity: Decimal, unit: string, maxDecimalPlaces = 4): string {
    const rounded = quantity.toDecimalPlaces(maxDecimalPlaces);
    // toFixed() gives trailing zeros; strip them
    const str = rounded.toFixed();
    const trimmed = str.includes('.')
      ? str.replace(/\.?0+$/, '')
      : str;
    return `${trimmed} ${unit}`;
  }

  /**
   * Format both UoM and UoO values. Returns only one string when UoM === UoO
   * (i.e. conversionFactor is 1 and unit strings are equal).
   */
  formatBoth(
    quantityInUoM: Decimal,
    uom: string,
    conversionFactor: Decimal,
    uoo: string,
  ): string {
    const qUoO = this.toUoO(quantityInUoM, conversionFactor);
    if (uom === uoo && conversionFactor.eq(1)) {
      return this.format(quantityInUoM, uom);
    }
    return `${this.format(quantityInUoM, uom)} (${this.format(qUoO, uoo)})`;
  }
}

export const unitConversionService = new UnitConversionService();
