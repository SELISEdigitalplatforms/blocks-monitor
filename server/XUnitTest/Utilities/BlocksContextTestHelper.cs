// DEADCODE 2026-07-29: type(s) unreferenced anywhere in server or XUnitTest; whole file commented pending review
// using System;
// using System.Linq;
// using Blocks.Genesis;
//
// namespace XUnitTest.Utilities
// {
//     public static class BlocksContextTestHelper
//     {
//         public static BlocksContext Create(
//             string tenantId,
//             string[] roles,
//             string userId,
//             bool isAuthenticated,
//             string requestUri,
//             string organizationId,
//             DateTime expireOn,
//             string? email,
//             string[]? permissions,
//             string userName,
//             string phoneNumber,
//             string displayName,
//             string oauthToken,
//             string refreshToken,
//             string? actualTenantId = null)
//         {
//             // var tId = actualTenantId ?? tenantId;
//             var safePermissions = permissions ?? Array.Empty<string>();
//
//             var createMethods = typeof(BlocksContext).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
//                 .Where(m => m.Name == "Create" && m.ReturnType == typeof(BlocksContext))
//                 .ToList();
//
//             var create15Method = createMethods.FirstOrDefault(m => m.GetParameters().Length == 15);
//             if (create15Method != null)
//             {
//                 return (BlocksContext)create15Method.Invoke(null, new object?[]
//                 {
//                     tenantId, roles, userId, isAuthenticated, requestUri, organizationId,
//                     expireOn, email ?? string.Empty, safePermissions, userName, phoneNumber,
//                     displayName, oauthToken, actualTenantId, refreshToken
//                 })!;
//             }
//
//             var create14Method = createMethods.FirstOrDefault(m => m.GetParameters().Length == 14);
//             if (create14Method != null)
//             {
//                 return (BlocksContext)create14Method.Invoke(null, new object?[]
//                 {
//                     tenantId, roles, userId, isAuthenticated, requestUri, organizationId,
//                     expireOn, email ?? string.Empty, safePermissions, userName, phoneNumber,
//                     displayName, oauthToken, actualTenantId
//                 })!;
//             }
//
//             throw new InvalidOperationException("Could not find a compatible BlocksContext.Create method.");
//         }
//     }
// }
