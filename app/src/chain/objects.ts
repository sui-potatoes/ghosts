// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import type { BcsType } from "@mysten/sui/bcs";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { WrittenObject } from "./fast-lane";

/** Minimal object reference, enough to pass an object to a transaction. */
export type ObjectRef = {
    objectId: string;
    version: string;
    digest: string;
};

/** A BCS-decoded object together with its on-chain reference. */
export type WithRef<T> = T & ObjectRef;

/**
 * The newest version of each object this client has seen. Reads go to whichever
 * node answers, and one a moment behind would hand back what a write just
 * replaced; a read older than this keeps what is on screen.
 */
const versions = new Map<string, bigint>();
/** How each object read by `useBcsObject` decodes, so a write can be read straight into it. */
const schemas = new Map<string, BcsType<unknown>>();

/** Note an object's version as read; false when it is older than one already seen. */
export function current(objectId: string, version: string | bigint): boolean {
    const seen = versions.get(objectId);
    const read = BigInt(version);
    if (seen !== undefined && read < seen) return false;
    versions.set(objectId, read);
    return true;
}

/** Bring every `useBcsObject` read in line with what a write left, without a read. */
export function absorbWrites(queryClient: QueryClient, written: WrittenObject[]) {
    for (const { objectId, version, contents } of written) {
        if (!current(objectId, version)) continue;
        const schema = schemas.get(objectId);
        if (schema && contents)
            queryClient.setQueryData(["object", objectId], schema.parse(contents));
    }
}

type UseBcsObjectArgs<T, Input> = {
    /** Object id to fetch; query is disabled while empty. */
    id?: string | null;
    /** BCS schema used to decode the object's content. */
    schema: BcsType<T, Input>;
    enabled?: boolean;
    refetchInterval?: number;
};

/** Fetch a single object by id and BCS-decode its content. */
export function useBcsObject<T, Input = T>({
    id,
    schema,
    enabled = true,
    refetchInterval,
}: UseBcsObjectArgs<T, Input>) {
    const client = useCurrentClient();
    const queryClient = useQueryClient();
    if (id) schemas.set(id, schema as BcsType<unknown>);
    return useQuery({
        queryKey: ["object", id],
        enabled: enabled && !!id,
        refetchInterval,
        // A poll is someone waiting on the chain, and they may be in another tab.
        refetchIntervalInBackground: true,
        queryFn: async (): Promise<T> => {
            const { object } = await client.core.getObject({
                objectId: id!,
                include: { content: true },
            });
            const shown = queryClient.getQueryData<T>(["object", id]);
            if (!current(id!, object.version) && shown !== undefined) return shown;
            return schema.parse(object.content);
        },
    });
}

type UseOwnedBcsObjectsArgs<T, Input, R> = {
    /** Address (or object id) owning the objects. */
    owner?: string | null;
    /** Object type filter: a package, `package::module`, or a full struct tag. */
    type: string;
    /** BCS schema used to decode each object's content. */
    schema: BcsType<T, Input>;
    enabled?: boolean;
    refetchInterval?: number;
    gcTime?: number;
    select?: (items: WithRef<T>[]) => R;
};

/**
 * Fetch all objects of a given type owned by an address and BCS-decode them.
 * The decoded fields are merged with the object's `objectId`/`version`/`digest`.
 */
export function useOwnedBcsObjects<T, Input = T, R = WithRef<T>[]>({
    owner,
    type,
    schema,
    enabled = true,
    refetchInterval,
    gcTime,
    select,
}: UseOwnedBcsObjectsArgs<T, Input, R>) {
    const client = useCurrentClient();
    return useQuery({
        queryKey: ["owned-objects", type, owner],
        enabled: enabled && !!owner,
        refetchInterval,
        gcTime,
        queryFn: async (): Promise<WithRef<T>[]> => {
            const { objects } = await client.core.listOwnedObjects({
                owner: owner!,
                type,
                include: { content: true },
            });

            return objects.map((object) => ({
                ...schema.parse(object.content),
                objectId: object.objectId,
                version: object.version,
                digest: object.digest,
            }));
        },
        select,
    });
}
