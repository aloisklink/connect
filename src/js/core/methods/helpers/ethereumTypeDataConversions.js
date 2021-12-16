/* @flow */

import BigNumber from 'bignumber.js';
import type { EthereumSignTypedDataTypes } from '../../../types/networks/ethereum';
import type { EthereumFieldType } from '../../../types/trezor/protobuf';
import { Enum_EthereumDataType } from '../../../types/trezor/protobuf';
import { ERRORS } from '../../../constants';
import { stripHexPrefix } from '../../../utils/formatUtils';

// Copied from https://github.com/ethers-io/ethers.js/blob/v5.5.2/packages/abi/src.ts/fragments.ts#L249
const paramTypeArray = new RegExp(/^(.*)\[([0-9]*)\]$/);
const paramTypeBytes = new RegExp(/^bytes([0-9]*)$/);
const paramTypeNumber = new RegExp(/^(u?int)([0-9]*)$/);

/**
 * Parse the given EIP-712 array type into its entries, and its length (if not dynamic)
 * E.g. `uint16[32]` will return `{entryTypeName: 'uint16', arraySize: 32}`.
 */
export function parseArrayType(arrayTypeName: string): {
    entryTypeName: string,
    arraySize: number | null,
} {
    const arrayMatch = paramTypeArray.exec(arrayTypeName);
    if (arrayMatch === null) {
        throw ERRORS.TypedError(
            'Method_InvalidParameter',
            `typename ${arrayTypeName} could not be parsed as an EIP-712 array`,
        );
    }
    const [_, entryTypeName, arraySize] = arrayMatch;
    return {
        entryTypeName,
        arraySize: parseInt(arraySize, 10) || null,
    };
}

/**
 * Converts a number to a two's compliment representation.
 *
 * E.g. -128 would be 0x80 in two's compliment, while 127 would be 0x7F.
 *
 * BigNumber.js has no built-in function, unlike https://www.npmjs.com/package/bn.js
 */
function twosCompliment(number: BigNumber, bytes: number): BigNumber {
    if (bytes < 1 || bytes > 32) {
        throw new Error('Int byte size must be between is 1 and 32');
    }
    // Determine value range
    const minValue = new BigNumber(2).exponentiatedBy(bytes * 8 - 1).negated();
    const maxValue = minValue.negated().plus(1);

    const bigNumber = new BigNumber(number);

    if (bigNumber.isGreaterThan(maxValue) || bigNumber.isLessThan(minValue)) {
        throw new Error(`Overflow when trying to convert number ${number} into ${bytes} bytes`);
    }

    if (bigNumber.isPositive()) {
        return bigNumber;
    }
    return bigNumber.minus(minValue).plus(minValue.negated());
}

// $FlowIssue bigint-unsupported, TODO: Update flow when bigint is supported
function intToHex(number: number | bigint | BigNumber | string, bytes: number, signed: boolean): string {
    let bigNumber = new BigNumber(number);
    if (signed) {
        bigNumber = twosCompliment(bigNumber, bytes);
    }
    const hex = bigNumber.toString(16);
    const hexChars = bytes * 2;
    if (hex.length > hexChars) {
      throw new Error(`Overflow when trying to convert number ${number} into ${bytes} bytes`);
    }
    return hex.padStart(bytes * 2, '0');
}

/**
 * Encodes the given primitive data to a big-endian hex string.
 *
 * @param typeName - Primitive Solidity data type (e.g. `uint16`)
 * @param data - The actual data to convert.
 * @returns Hex string of the data.
 */
export function encodeData(typeName: string, data: any): string | Uint8Array {
    if (paramTypeBytes.test(typeName) || typeName === 'address') {
        return stripHexPrefix(data);
    }
    if (typeName === 'string') {
        return new TextEncoder().encode(data);
    }
    const numberMatch = paramTypeNumber.exec(typeName);
    if (numberMatch) {
        const [_, intType, bits] = numberMatch;
        const bytes = Math.ceil(parseInt(bits, 10) / 8);
        return intToHex(data, bytes, intType === 'int');
    }
    if (typeName === 'bool') {
        return data ? '01' : '00';
    }

    // We should be receiving only atomic, non-array types
    throw ERRORS.TypedError(
        'Method_InvalidParameter',
        `Unsupported data type for direct field encoding: ${typeName}`,
    );
}

// these are simple types, so we can just do a string-match
const paramTypesMap = {
    string: Enum_EthereumDataType.STRING,
    bool: Enum_EthereumDataType.BOOL,
    address: Enum_EthereumDataType.ADDRESS,
};

/**
 * Converts the given EIP-712 typename into a Protobuf package.
 *
 * @param typeName - The EIP-712 typename (e.g. `uint16` for simple types, `Example` for structs)
 * @param types - Map of types, required for recursive (`struct`) types.
 */
export function getFieldType(
    typeName: string,
    types: EthereumSignTypedDataTypes,
): EthereumFieldType {
    const arrayMatch = paramTypeArray.exec(typeName);
    if (arrayMatch) {
        const [_, arrayItemTypeName, arraySize] = arrayMatch;
        const entryType = getFieldType(arrayItemTypeName, types);
        if (entryType.data_type === Enum_EthereumDataType.ARRAY) {
            throw ERRORS.TypedError('Method_InvalidParameter', 'Nested arrays are not supported');
        }
        return {
            data_type: Enum_EthereumDataType.ARRAY,
            size: parseInt(arraySize, 10) || undefined,
            entry_type: entryType,
        };
    }

    const numberMatch = paramTypeNumber.exec(typeName);
    if (numberMatch) {
        const [_, type, bits] = numberMatch;
        return {
            data_type: type === 'uint' ? Enum_EthereumDataType.UINT : Enum_EthereumDataType.INT,
            size: Math.floor(parseInt(bits, 10) / 8),
        };
    }

    const bytesMatch = paramTypeBytes.exec(typeName);
    if (bytesMatch) {
        const [_, size] = bytesMatch;
        return {
            data_type: Enum_EthereumDataType.BYTES,
            size: parseInt(size, 10) || undefined,
        };
    }

    const fixedSizeTypeMatch = paramTypesMap[typeName];
    if (fixedSizeTypeMatch) {
        return {
            data_type: fixedSizeTypeMatch,
        };
    }

    if (typeName in types) {
        return {
            data_type: Enum_EthereumDataType.STRUCT,
            size: types[typeName].length,
            struct_name: typeName,
        };
    }

    throw ERRORS.TypedError('Method_InvalidParameter', `Unsupported type name: ${typeName}`);
}
