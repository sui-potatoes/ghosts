// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * The app's one GraphQL client, read only, for what gRPC cannot do: listing the
 * shared `Game` objects (gRPC lists objects by owner only) and reading a game's
 * past beyond the fullnode's window. Everything else goes through the gRPC client.
 */

import { SuiGraphQLClient } from "@mysten/sui/graphql";

import { NETWORK } from "../constants.ts";
import type { GraphReader } from "./archive.ts";

/** The public GraphQL service for the network. */
export const GRAPHQL_URL = `https://graphql.${NETWORK}.sui.io/graphql`;

let client: SuiGraphQLClient | null = null;

/** The shared client, made on first use. */
export function graphql(): GraphReader {
    client ??= new SuiGraphQLClient({ url: GRAPHQL_URL, network: NETWORK });
    return client as unknown as GraphReader;
}

/** The shared objects of a type, with their contents: every live game. */
export const SHARED_OF_TYPE_QUERY = `query SharedOfType($type: String!, $after: String) {
    objects(first: 50, after: $after, filter: { type: $type, ownerKind: SHARED }) {
        pageInfo { hasNextPage endCursor }
        nodes { address version asMoveObject { contents { bcs } } }
    }
}`;

export interface SharedObject {
    address: string;
    version: string;
    /** The Move contents, base64 BCS. */
    bcs: string;
}

/** Every shared object of `type`, a few pages at most. */
export async function sharedOfType(
    reader: GraphReader,
    type: string,
    pages = 4,
): Promise<SharedObject[]> {
    const out: SharedObject[] = [];
    let after: string | null = null;
    for (let page = 0; page < pages; page++) {
        const { data, errors } = await reader.query({
            query: SHARED_OF_TYPE_QUERY,
            variables: { type, after },
        });
        if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
        const objects = (
            data as {
                objects: {
                    pageInfo: { hasNextPage: boolean; endCursor: string | null };
                    nodes: {
                        address: string;
                        version: number | string;
                        asMoveObject?: { contents?: { bcs: string } } | null;
                    }[];
                };
            }
        ).objects;
        for (const node of objects.nodes) {
            const bcs = node.asMoveObject?.contents?.bcs;
            if (bcs) out.push({ address: node.address, version: String(node.version), bcs });
        }
        if (!objects.pageInfo.hasNextPage) break;
        after = objects.pageInfo.endCursor;
    }
    return out;
}
