/* @flow */

import AbstractMethod from './AbstractMethod';
import { validateParams, getFirmwareRange } from './helpers/paramsValidator';
import { validatePath } from '../../utils/pathUtils';
import { getEthereumNetwork } from '../../data/CoinInfo';
import { toChecksumAddress, getNetworkLabel } from '../../utils/ethereumUtils';
import type { CoreMessage, EthereumNetworkInfo } from '../../types';
import type {
    MessageResponse,
    EthereumTypedDataSignature,
    EthereumTypedDataStructAck,
    EthereumTypedDataValueRequest,
} from '../../types/trezor/protobuf';
import { ERRORS } from '../../constants';
import type { EthereumSignTypedData as EthereumSignTypedDataParams } from '../../types/networks/ethereum';
import { getFieldType, parseArrayType, encodeData } from './helpers/ethereumTypeDataConversions';

type Params = {
    ...EthereumSignTypedDataParams,
    path: number[],
    network?: EthereumNetworkInfo,
};

export default class EthereumSignTypedData extends AbstractMethod {
    params: Params;

    constructor(message: CoreMessage) {
        super(message);

        this.requiredPermissions = ['read', 'write'];

        const { payload } = message;

        // validate incoming parameters
        validateParams(payload, [
            { name: 'path', obligatory: true },
            { name: 'data', type: 'object', obligatory: true },
            { name: 'metamaskV4Compatibility', type: 'boolean', obligatory: true },
        ]);

        const path = validatePath(payload.path, 3);
        const network = getEthereumNetwork(path);
        this.firmwareRange = getFirmwareRange(this.name, network, this.firmwareRange);

        this.info = getNetworkLabel('Sign #NETWORK yped data', network);

        const { data, metamaskV4Compatibility } = payload;

        this.params = {
            path,
            network,
            data,
            metamaskV4Compatibility,
        };
    }

    async run() {
        const cmd = this.device.getCommands();
        const { path: address_n, network, data, metamaskV4Compatibility } = this.params;

        const { types, primaryType, domain, message } = data;

        let response: MessageResponse<
            | 'EthereumTypedDataStructRequest'
            | 'EthereumTypedDataValueRequest'
            | 'EthereumTypedDataSignature',
        > = await cmd.typedCall(
            'EthereumSignTypedData',
            // $FlowIssue typedCall problem with unions in response, TODO: accept unions
            'EthereumTypedDataStructRequest|EthereumTypedDataValueRequest|EthereumTypedDataSignature',
            {
                address_n,
                primary_type: primaryType,
                metamask_v4_compat: metamaskV4Compatibility,
            },
        );

        // sending all the type data
        while (response.type === 'EthereumTypedDataStructRequest') {
            // $FlowIssue disjoint union Refinements not working, TODO: check if new Flow versions fix this
            const { name: typeDefinitionName } = response.message;
            const typeDefinition = types[typeDefinitionName];
            if (typeDefinition === undefined) {
                throw ERRORS.TypedError(
                    'Method_InvalidParameter',
                    `Type ${typeDefinitionName} was not defined in types object`,
                );
            }
            const dataStruckAck: EthereumTypedDataStructAck = {
                members: typeDefinition.map(({ name, type: typeName }) => ({
                    name,
                    type: getFieldType(typeName, types),
                })),
            };
            response = await cmd.typedCall(
                'EthereumTypedDataStructAck',
                // $FlowIssue typedCall problem with unions in response, TODO: accept unions
                'EthereumTypedDataStructRequest|EthereumTypedDataValueRequest|EthereumTypedDataSignature',
                dataStruckAck,
            );
        }

        // sending the whole message to be signed
        while (response.type === 'EthereumTypedDataValueRequest') {
            // $FlowIssue disjoint union Refinements not working, TODO: check if new Flow versions fix this
            const valueRequestMessage: EthereumTypedDataValueRequest = response.message;
            const { member_path } = valueRequestMessage;

            let memberData;
            let memberTypeName;

            const [rootIndex, ...nestedMemberPath] = member_path;
            switch (rootIndex) {
                case 0:
                    memberData = domain;
                    memberTypeName = 'EIP712Domain';
                    break;
                case 1:
                    memberData = message;
                    memberTypeName = primaryType;
                    break;
                default:
                    throw ERRORS.TypedError(
                        'Method_InvalidParameter',
                        'Root index can only be 0 or 1',
                    );
            }

            // It can be asking for a nested structure (the member path being [X, Y, Z, ...])
            for (const index of nestedMemberPath) {
                if (Array.isArray(memberData)) {
                    memberTypeName = parseArrayType(memberTypeName).entryTypeName;
                    memberData = memberData[index];
                } else if (typeof memberData === 'object' && memberData !== null) {
                    const memberTypeDefinition = types[memberTypeName][index];
                    memberTypeName = memberTypeDefinition.type;
                    memberData = memberData[memberTypeDefinition.name];
                } else {
                    // TODO: what to do when the value is missing (for example in recursive types)?
                }
            }

            let encodedData;
            // If we were asked for a list, first sending its length and we will be receiving
            // requests for individual elements later
            if (Array.isArray(memberData)) {
                // Sending the length as uint16
                encodedData = encodeData('uint16', memberData.length);
            } else {
                encodedData = encodeData(memberTypeName, memberData);
            }

            // $FlowIssue with `await` and Promises: https://github.com/facebook/flow/issues/5294, TODO: Update flow
            response = await cmd.typedCall(
                'EthereumTypedDataValueAck',
                // $FlowIssue typedCall problem with unions in response, TODO: accept unions
                'EthereumTypedDataValueRequest|EthereumTypedDataSignature',
                {
                    // $FlowIssue protobuf.js is okay with Uint8Array: TODO: update scripts/protobuf-types.js
                    value: encodedData,
                },
            );
        }

        // $FlowIssue disjoint union Refinements not working, TODO: check if new Flow versions fix this
        const signatureMessage: EthereumTypedDataSignature = response.message;
        return {
            address: toChecksumAddress(signatureMessage.address, network),
            signature: `0x${signatureMessage.signature}`,
        };
    }
}
